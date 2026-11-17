import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import express from "express";
import request from "supertest";
import { createRuntimeDiagnostics } from "../server/runtime-diagnostics.js";
import { createApp } from "../server/app.js";

test("DB failures retain a safe cause and route in the same runtime record", async (t) => {
  const entries = [];
  const pool = {
    query: async () => {
      throw Object.assign(new Error("Query read timeout"), {
        detail: "private-sql-and-credentials",
      });
    },
  };
  const diagnostics = createRuntimeDiagnostics({
    pool,
    write: (line) => entries.push(JSON.parse(line)),
  });
  t.after(() => diagnostics.close());
  const app = createApp({ pool, diagnostics, rateLimits: false });
  await request(app).get("/api/health?token=private-token").expect(503);
  const failure = entries.find(
    (r) => r.event === "database_request_unavailable",
  );
  assert.equal(failure.code, "QUERY_TIMEOUT");
  assert.equal(failure.route, "/api/health");
  assert.equal(failure.method, "GET");
  assert.doesNotMatch(JSON.stringify(entries), /private-|Query read timeout/);
});

test("request diagnostics use route templates and exclude user data and credentials", async (t) => {
  const entries = [];
  const diagnostics = createRuntimeDiagnostics({
    pool: { totalCount: 5, idleCount: 1, waitingCount: 2 },
    write: (line) => entries.push(JSON.parse(line)),
  });
  t.after(() => diagnostics.close());
  const app = express();
  app.use(diagnostics.middleware);
  app.post("/cycles/:cycleId", (req, res) => res.sendStatus(503));
  await request(app)
    .post("/cycles/private-id?token=private-query")
    .set("Authorization", "Bearer private-auth")
    .send({ text: "private-body" });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].route, "/cycles/:cycleId");
  assert.equal(entries[0].activeRequests, 0);
  assert.equal(entries[0].status, 503);
  assert.deepEqual(entries[0].pool, { total: 5, idle: 1, waiting: 2 });
  assert.doesNotMatch(JSON.stringify(entries), /private-|Bearer/);
});

test("sampling records an actual event-loop stall and the cleanup leaves no running timer", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { setTimeout as wait } from 'node:timers/promises';
    import { createRuntimeDiagnostics } from './server/runtime-diagnostics.js';
    const entries = [];
    const diagnostics = createRuntimeDiagnostics({ intervalMs: 50, write: line => entries.push(JSON.parse(line)) });
    await wait(130);
    const until = performance.now() + 220;
    while (performance.now() < until) {}
    await wait(130);
    diagnostics.close();
    console.log(JSON.stringify(entries));
  `,
    ],
    { cwd: new URL("..", import.meta.url), encoding: "utf8", timeout: 3000 },
  );
  assert.equal(result.status, 0, result.stderr);
  const entries = JSON.parse(result.stdout);
  assert.ok(
    entries.some((e) => Math.max(e.eventLoopMaxMs, e.sampleDelayMs) >= 150),
  );
  assert.ok(
    entries.every((e) => e.rssMiB > 0 && Number.isFinite(e.cpuPercent)),
  );
  assert.equal(new Set(entries.map((e) => e.bootId)).size, 1);
});
