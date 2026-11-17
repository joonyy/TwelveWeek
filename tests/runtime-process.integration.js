import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("Runtime process tests require a dedicated _test database");

test("fatal monitoring records the cause without swallowing Node's crash", () => {
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import './server/index.js';
    setTimeout(() => {
      throw Object.assign(new TypeError('test-only fatal marker'), {code: 'ETIMEDOUT'});
    }, 100);
  `,
    ],
    {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, DATABASE_URL: url, PORT: "0" },
      encoding: "utf8",
      timeout: 8000,
    },
  );
  assert.equal(child.status, 1, child.stderr);
  const records = child.stdout
    .split("\n")
    .filter((line) => line.startsWith('{"event":'))
    .map((line) => JSON.parse(line));
  const fatal = records.find((r) => r.event === "process_fatal");
  assert.equal(fatal.origin, "uncaughtException");
  assert.equal(fatal.code, "ETIMEDOUT");
  assert.equal(fatal.errorType, "TypeError");
  assert.equal(records.at(-1).event, "process_exit");
  assert.equal(records.at(-1).exitCode, 1);
  assert.doesNotMatch(
    JSON.stringify(records),
    /test-only fatal marker|postgres:\/\//,
  );
});

test("the actual API logs its startup, readiness and shutdown signal without leaking its DB URL", async () => {
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, DATABASE_URL: url, PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = once(child, "exit");
  let output = "",
    errors = "";
  const ready = new Promise((resolve) =>
    child.stdout.on("data", (data) => {
      output += data;
      if (output.includes('"event":"database_ready"')) resolve();
    }),
  );
  child.stderr.on("data", (data) => {
    errors += data;
  });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 8000);
  try {
    await Promise.race([
      ready,
      exited.then(() => {
        throw new Error(`API exited before ready: ${errors}`);
      }),
    ]);
    child.kill("SIGTERM");
    const [code, signal] = await exited;
    assert.equal(signal, null, errors);
    assert.equal(code, 0, errors);
    const records = output
      .split("\n")
      .filter((line) => line.startsWith('{"event":'))
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      records.map((r) => r.event),
      ["process_started", "database_ready", "process_stopping", "process_exit"],
    );
    assert.equal(records[2].reason, "SIGTERM");
    assert.equal(new Set(records.map((r) => r.bootId)).size, 1);
    assert.ok(!output.includes(url));
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
});
