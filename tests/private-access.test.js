import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import request from "supertest";
import { createApp } from "../server/app.js";

const key = "random-private-installation-entry-key-for-test";
const accessHash = createHash("sha256").update(key).digest("hex");

function fixture(privateAccessHash = accessHash, rateLimits = false) {
  const queries = [];
  const pool = {
    async query(sql) {
      queries.push(sql);
      if (sql.includes("SELECT id,name FROM profiles"))
        return { rows: [{ id: "test-profile", name: "Private user" }] };
      if (sql.includes("FROM sessions s JOIN profiles"))
        return {
          rowCount: 1,
          rows: [{ id: "test-profile", name: "Private user" }],
        };
      return { rows: [], rowCount: 0 };
    },
  };
  return { app: createApp({ pool, privateAccessHash, rateLimits }), queries };
}

test("private setup exposes health and access status but no profiles or new sessions without the key", async () => {
  const { app, queries } = fixture();
  assert.deepEqual((await request(app).get("/api/access").expect(200)).body, {
    required: true,
  });
  await request(app).get("/api/health").expect(200);
  queries.length = 0;
  for (const value of [undefined, "incorrect", "x".repeat(10000)]) {
    for (const [method, path] of [
      ["get", "/api/profiles"],
      ["post", "/api/profiles"],
      ["post", "/api/sessions"],
    ]) {
      let call = request(app)[method](path);
      if (value) call = call.set("X-Private-Access-Key", value);
      const response = await call.expect(403);
      assert.equal(response.headers["cache-control"], "no-store");
    }
  }
  assert.equal(queries.length, 0);
});

test("the private key unlocks profile selection without being returned or stored", async () => {
  const { app } = fixture();
  const response = await request(app)
    .get("/api/profiles")
    .set("X-Private-Access-Key", key)
    .expect(200);
  assert.equal(response.body[0].name, "Private user");
  assert.ok(!response.text.includes(key));
});

test("existing bearer sessions and logout do not require retaining the entry key", async () => {
  const { app } = fixture();
  const authorization = `Bearer ${"a".repeat(43)}`;
  await request(app)
    .get("/api/me")
    .set("Authorization", authorization)
    .expect(200);
  await request(app)
    .delete("/api/sessions/current")
    .set("Authorization", authorization)
    .expect(204);
});

test("local development retains the original profile flow when no private key is configured", async () => {
  const { app } = fixture("");
  assert.deepEqual((await request(app).get("/api/access")).body, {
    required: false,
  });
  await request(app).get("/api/profiles").expect(200);
});

test("invalid access-key digests fail closed", () => {
  assert.throws(() => fixture("not-a-digest"), /SHA-256/);
});

test("repeated wrong entry keys are rate limited", async () => {
  const { app } = fixture(accessHash, true);
  for (let i = 0; i < 30; i++)
    await request(app).get("/api/profiles").expect(403);
  await request(app).post("/api/sessions").expect(429);
});
