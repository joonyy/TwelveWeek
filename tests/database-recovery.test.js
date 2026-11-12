import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import request from "supertest";
import { initializeDatabase } from "../server/database-startup.js";
import { transaction } from "../server/db.js";
import { createApp } from "../server/app.js";

test("an idle database disconnect cannot terminate the API process or expose credentials", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { createPool } from './server/db.js';
    const pool = createPool('postgres://test:private-password@127.0.0.1:1/test_only');
    pool.emit('error', Object.assign(new Error('postgres://test:private-password@private-host/db'), {code:'ECONNRESET'}));
    await pool.end();
    console.log('process survived');
  `,
    ],
    {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_ENV: "test",
        DATABASE_SSL: "false",
        DATABASE_CA_PATH: "",
        DATABASE_CA_PEM: "",
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /process survived/);
  assert.match(result.stderr, /ECONNRESET/);
  assert.doesNotMatch(
    result.stderr,
    /private-password|private-host|postgres:\/\//,
  );
});

test("a lost COMMIT is not replayed and failed rollback discards its connection", async () => {
  const lost = Object.assign(new Error("Connection terminated unexpectedly"), {
    code: "ECONNRESET",
  });
  const queries = [],
    released = [];
  let writes = 0;
  const client = {
    async query(sql) {
      queries.push(sql);
      if (sql === "COMMIT" || sql === "ROLLBACK") throw lost;
    },
    release(discard) {
      released.push(discard);
    },
  };
  await assert.rejects(
    transaction({ connect: async () => client }, async (db) => {
      writes++;
      await db.query("INSERT test-only data");
    }),
    (error) => error === lost,
  );
  assert.equal(writes, 1);
  assert.deepEqual(queries, [
    "BEGIN",
    "INSERT test-only data",
    "COMMIT",
    "ROLLBACK",
  ]);
  assert.deepEqual(released, [true]);
});

test("startup retries transient connection failures with backoff and completes when the DB returns", async () => {
  const delays = [],
    logs = [];
  let attempts = 0;
  await initializeDatabase({
    migrate: async () => {
      if (++attempts <= 6)
        throw Object.assign(new Error("private URL must not be logged"), {
          code: "ENOTFOUND",
        });
    },
    wait: async (ms) => delays.push(ms),
    log: (...args) => logs.push(args),
  });
  assert.equal(attempts, 7);
  assert.deepEqual(delays, [1000, 2000, 4000, 8000, 15000, 15000]);
  assert.doesNotMatch(JSON.stringify(logs), /private URL/);
});

test("migration and authentication errors fail closed instead of being retried", async () => {
  for (const code of ["42P01", "28P01", "23505"]) {
    let attempts = 0;
    const failure = Object.assign(new Error("fatal initialization error"), {
      code,
    });
    await assert.rejects(
      initializeDatabase({
        migrate: async () => {
          attempts++;
          throw failure;
        },
        wait: () => assert.fail("fatal migration must not retry"),
      }),
      (error) => error === failure,
    );
    assert.equal(attempts, 1);
  }
});

test("shutdown interrupts a startup retry without another migration", async () => {
  const controller = new AbortController();
  let attempts = 0;
  const pending = initializeDatabase({
    signal: controller.signal,
    migrate: async () => {
      attempts++;
      throw Object.assign(new Error(), { code: "ECONNREFUSED" });
    },
    log: () => {},
    wait: async (ms, value, { signal }) => {
      controller.abort();
      signal.throwIfAborted();
    },
  });
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(attempts, 1);
});

test("initial migrations gate readiness and writes without claiming a healthy deployment", async () => {
  const app = createApp({
    pool: {
      query: () => assert.fail("DB must not be touched during initialization"),
    },
    isReady: () => false,
    rateLimits: false,
  });
  const live = await request(app).get("/api/live").expect(503);
  assert.equal(live.body.code, "DATABASE_STARTING");
  await request(app).get("/api/health").expect(503);
  await request(app).get("/api/access").expect(200);
  await request(app).get("/api/profiles").expect(503);
  await request(app)
    .post("/api/profiles")
    .send({ name: "must not save", password: "test-password" })
    .expect(503);
});

test("DB outages return 503 while liveness stays up and the same app recovers", async () => {
  let offline = true;
  const pool = {
    query: async () => {
      if (offline)
        throw Object.assign(new Error("private host and SQL"), {
          code: "57P01",
        });
      return { rows: [], rowCount: 0 };
    },
  };
  const app = createApp({ pool, rateLimits: false });
  const failure = await request(app).get("/api/health").expect(503);
  assert.equal(failure.body.code, "DATABASE_UNAVAILABLE");
  assert.equal(failure.headers["retry-after"], "5");
  assert.doesNotMatch(JSON.stringify(failure.body), /private host|SQL/);
  await request(app).get("/api/profiles").expect(503);
  await request(app).get("/api/live").expect(200);
  await request(app).get("/api/access").expect(200);
  offline = false;
  const health = await request(app).get("/api/health").expect(200);
  assert.equal(health.body.features.dayTemplates, 1);
  await request(app).get("/api/profiles").expect(200);
});
