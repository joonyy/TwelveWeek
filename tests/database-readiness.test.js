import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createReadinessProbe } from "../server/database-readiness.js";
import {
  databaseErrorCode,
  isDatabaseUnavailable,
} from "../server/database-errors.js";
import { createApp } from "../server/app.js";

test("the production readiness deadline returns before Render's five-second limit", async () => {
  let release;
  const pool = {
    query: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  };
  const app = createApp({ pool, rateLimits: false });
  const started = performance.now();
  const health = request(app)
    .get("/api/health")
    .then((r) => r);
  await request(app).get("/api/live").expect(200);
  const response = await health;
  assert.equal(response.status, 503);
  assert.ok(performance.now() - started < 4000);
  release({ rows: [] });
});

test("a stalled DB fails readiness promptly while liveness keeps answering", async () => {
  let queries = 0,
    release;
  const pool = {
    query: () => {
      queries++;
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  };
  const app = createApp({
    pool,
    readinessProbe: createReadinessProbe(pool, { timeoutMs: 25 }),
    rateLimits: false,
  });
  const results = await Promise.all(
    Array.from({ length: 8 }, () => request(app).get("/api/health")),
  );
  assert.equal(queries, 1);
  assert.ok(
    results.every(
      (r) => r.status === 503 && r.body.code === "DATABASE_UNAVAILABLE",
    ),
  );
  await request(app).get("/api/live").expect(200);
  await request(app).get("/api/health").expect(503);
  assert.equal(queries, 1, "timed-out probes must not enqueue more DB work");
  release({ rows: [] });
  await new Promise((resolve) => setImmediate(resolve));
  pool.query = async () => {
    queries++;
    return { rows: [] };
  };
  await request(app).get("/api/health").expect(200);
  assert.equal(queries, 2);
});

test("a failed probe can recover and late query rejection is handled", async () => {
  let reject;
  const pool = {
    query: () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  };
  const probe = createReadinessProbe(pool, { timeoutMs: 10 });
  await assert.rejects(probe(), { code: "ETIMEDOUT" });
  reject(
    Object.assign(new Error("private connection details"), {
      code: "ECONNRESET",
    }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  pool.query = async () => ({ rows: [] });
  await probe();
});

test("code-less pg failures have distinct safe operational labels", () => {
  for (const [message, code] of [
    ["Connection terminated unexpectedly", "CONNECTION_CLOSED"],
    ["Connection terminated due to connection timeout", "CONNECTION_TIMEOUT"],
    ["timeout exceeded when trying to connect", "POOL_ACQUIRE_TIMEOUT"],
    ["Query read timeout", "QUERY_TIMEOUT"],
    [
      "Client has encountered a connection error and is not queryable",
      "CLIENT_UNUSABLE",
    ],
  ]) {
    const error = new Error(message);
    assert.equal(isDatabaseUnavailable(error), true);
    assert.equal(databaseErrorCode(error), code);
  }
  assert.equal(
    databaseErrorCode(new Error("postgres://user:secret@private/db")),
    "DATABASE_ERROR",
  );
});
