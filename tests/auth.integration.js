import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { createPool } from "../server/db.js";
import { migrate } from "../server/migrate.js";
import { createApp } from "../server/app.js";
import { verifyPassword } from "../server/passwords.js";

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("Use a dedicated _test database");
const pool = createPool(url);
const app = createApp({ pool, rateLimits: false });
const password = "test-password";
let profile, token;
before(async () => {
  await migrate(pool);
  await pool.query(
    "TRUNCATE changes,weeks,cycles,sessions,profiles RESTART IDENTITY CASCADE",
  );
});
after(() => pool.end());

test("profile creation requires a password, keeps the name list, and never returns a password hash", async () => {
  await request(app)
    .post("/api/profiles")
    .send({ name: "No password" })
    .expect(400);
  await request(app)
    .post("/api/profiles")
    .send({ name: "Too short", password: "123" })
    .expect(400);
  profile = (
    await request(app)
      .post("/api/profiles")
      .send({ name: " Password User ", password })
      .expect(201)
  ).body;
  assert.deepEqual(Object.keys(profile).sort(), ["id", "name"]);
  const stored = (
    await pool.query("SELECT password_hash FROM profiles WHERE id=$1", [
      profile.id,
    ])
  ).rows[0].password_hash;
  assert.equal(await verifyPassword(password, stored), true);
  assert.notEqual(stored, password);
  const list = (await request(app).get("/api/profiles").expect(200)).body;
  assert.deepEqual(list, [profile]);
  const access = (await request(app).get("/api/access").expect(200)).body;
  assert.equal(access.required, false);
  assert.equal(access.authentication, "password");
});

test("sessions require the selected user's password and support normalized name login", async () => {
  await request(app)
    .post("/api/sessions")
    .send({ profileId: profile.id })
    .expect(400);
  const wrong = (
    await request(app)
      .post("/api/sessions")
      .send({ profileId: profile.id, password: "wrong" })
      .expect(401)
  ).body;
  const unknown = (
    await request(app)
      .post("/api/sessions")
      .send({ profileId: randomUUID(), password })
      .expect(401)
  ).body;
  assert.deepEqual(wrong, unknown);
  const session = (
    await request(app)
      .post("/api/sessions")
      .send({ name: "  PASSWORD USER  ", password })
      .expect(200)
  ).body;
  token = session.token;
  assert.deepEqual(session.profile, profile);
  assert.equal(token.length, 43);
  await request(app)
    .get("/api/me")
    .set("Authorization", `Bearer ${token}`)
    .expect(200);
});

test("changing a password preserves plans and the current device while revoking other device sessions", async () => {
  const otherToken = (
    await request(app)
      .post("/api/sessions")
      .send({ profileId: profile.id, password })
      .expect(200)
  ).body.token;
  const headers = { Authorization: `Bearer ${token}` };
  const cycle = (
    await request(app)
      .post("/api/cycles")
      .set(headers)
      .send({ title: "보존할 목표", startDate: "2026-11-02", weekCount: 10 })
      .expect(201)
  ).body;
  await request(app)
    .put("/api/me/password")
    .set(headers)
    .send({ currentPassword: "wrong", newPassword: "new-password" })
    .expect(400);
  await request(app).get("/api/me").set(headers).expect(200);
  await request(app)
    .put("/api/me/password")
    .set(headers)
    .send({ currentPassword: password, newPassword: "new-password" })
    .expect(204);
  await request(app).get("/api/me").set(headers).expect(200);
  await request(app)
    .get("/api/me")
    .set("Authorization", `Bearer ${otherToken}`)
    .expect(401);
  await request(app)
    .post("/api/sessions")
    .send({ profileId: profile.id, password })
    .expect(401);
  await request(app)
    .post("/api/sessions")
    .send({ profileId: profile.id, password: "new-password" })
    .expect(200);
  assert.deepEqual(
    (await request(app).get(`/api/cycles/${cycle.id}`).set(headers).expect(200))
      .body,
    cycle,
  );
});

test("repeated incorrect password attempts are rate limited", async () => {
  const limited = createApp({ pool, rateLimits: true });
  for (let i = 0; i < 30; i++)
    await request(limited)
      .post("/api/sessions")
      .send({ profileId: profile.id, password: "wrong" })
      .expect(401);
  await request(limited)
    .post("/api/sessions")
    .send({ profileId: profile.id, password: "wrong" })
    .expect(429);
});
