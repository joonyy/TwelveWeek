import { test } from "node:test";
import assert from "node:assert/strict";
import { requestDeploy } from "../scripts/render-deploy.js";
const sha = "a".repeat(40),
  serviceId = "srv-test",
  secret = "never-print-this-secret";
const hook = `https://api.render.com/deploy/${serviceId}?key=${secret}`;
test("deploy requests pin the verified commit and distinguish started from queued", async () => {
  const result = await requestDeploy(
    { hook, serviceId, sha },
    async (url, options) => {
      assert.equal(url.searchParams.get("ref"), sha);
      assert.equal(url.searchParams.get("key"), secret);
      assert.equal(options.method, "POST");
      assert.equal(options.redirect, "error");
      return new Response(JSON.stringify({ deploy: { id: "dep-example" } }), {
        status: 200,
      });
    },
  );
  assert.deepEqual(result, { status: "started", id: "dep-example" });
  assert.deepEqual(
    await requestDeploy(
      { hook, serviceId, sha },
      async () => new Response("", { status: 202 }),
    ),
    { status: "queued", id: null },
  );
});
test("invalid commit and wrong service hooks fail before making a request", async () => {
  for (const input of [
    { hook, serviceId, sha: "main" },
    { hook, serviceId: "srv-other", sha },
    { hook: "http://api.render.com/deploy/srv-test?key=x", serviceId, sha },
    { hook: "https://example.com/deploy/srv-test?key=x", serviceId, sha },
    { hook: "", serviceId, sha },
  ]) {
    await assert.rejects(
      requestDeploy(input, () =>
        assert.fail("No network request should be made"),
      ),
    );
  }
});
test("deploy failures do not leak secrets or retry an ambiguous POST", async () => {
  let attempts = 0;
  const failures = [
    async () => {
      attempts++;
      throw new Error(hook);
    },
    async () => new Response(hook, { status: 401 }),
    async () => new Response(hook, { status: 200 }),
  ];
  for (const failure of failures) {
    await assert.rejects(
      requestDeploy({ hook, serviceId, sha }, failure),
      (error) =>
        !error.message.includes(secret) && !error.message.includes("https://"),
    );
  }
  assert.equal(attempts, 1);
});
