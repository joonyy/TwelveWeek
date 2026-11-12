import { test } from "node:test";
import assert from "node:assert/strict";
import { withRequestDeadline } from "../shared/request-deadline.js";

test("a request deadline aborts a stalled request once without retrying writes", async () => {
  let attempts = 0,
    signal;
  await assert.rejects(
    withRequestDeadline((s) => {
      attempts++;
      signal = s;
      return new Promise(() => {});
    }, 10),
    { code: "REQUEST_TIMEOUT" },
  );
  assert.equal(attempts, 1);
  assert.equal(signal.aborted, true);
});

test("the deadline covers a response whose headers arrived but body stalled", async () => {
  await assert.rejects(
    withRequestDeadline(async () => {
      const response = { json: () => new Promise(() => {}) };
      return await response.json();
    }, 10),
    { code: "REQUEST_TIMEOUT" },
  );
});

test("completed requests preserve results and errors without a late abort", async () => {
  let signal;
  assert.deepEqual(
    await withRequestDeadline(async (s) => {
      signal = s;
      return { saved: true };
    }, 10),
    { saved: true },
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(signal.aborted, false);
  const failure = Object.assign(new Error("version conflict"), { status: 409 });
  await assert.rejects(
    withRequestDeadline(() => {
      throw failure;
    }, 10),
    (error) => error === failure,
  );
});
