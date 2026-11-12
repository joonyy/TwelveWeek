import { test, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createPool } from "../server/db.js";
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("Database recovery tests require a dedicated _test database");
const pool = createPool(url),
  control = createPool(url);
after(async () => {
  await pool.end();
  await control.end();
});

test("an actual PostgreSQL idle-session termination is handled and the next query reconnects", async () => {
  const client = await pool.connect();
  const pid = (await client.query("SELECT pg_backend_pid() AS pid")).rows[0]
    .pid;
  client.release();
  const disconnected = once(pool, "error");
  await control.query("SELECT pg_terminate_backend($1)", [pid]);
  const [error] = await disconnected;
  assert.ok(
    ["57P01", "ECONNRESET"].includes(error.code) ||
      /terminat/i.test(error.message),
  );
  assert.equal((await pool.query("SELECT 1 AS ok")).rows[0].ok, 1);
});

test("server-side statement cancellation leaves the connection usable", async () => {
  const client = await pool.connect();
  try {
    assert.equal(
      (await client.query("SHOW statement_timeout")).rows[0].statement_timeout,
      "10s",
    );
    assert.equal(
      (await client.query("SHOW lock_timeout")).rows[0].lock_timeout,
      "5s",
    );
    await client.query("SET statement_timeout='50ms'");
    await assert.rejects(client.query("SELECT pg_sleep(0.2)"), {
      code: "57014",
    });
    assert.equal((await client.query("SELECT 1 AS ok")).rows[0].ok, 1);
  } finally {
    client.release(true);
  }
});
