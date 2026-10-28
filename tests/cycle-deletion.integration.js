import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { createPool } from "../server/db.js";
import { migrate } from "../server/migrate.js";
import { createApp } from "../server/app.js";
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("Use a dedicated _test database");
const pool = createPool(url),
  app = createApp({ pool, rateLimits: false });
let headers, otherHeaders, draft, retained, otherCycle;
before(async () => {
  await migrate(pool);
  await pool.query(
    "TRUNCATE changes,weeks,cycles,sessions,profiles RESTART IDENTITY CASCADE",
  );
  async function user(name) {
    const profile = (
      await request(app)
        .post("/api/profiles")
        .send({ name, password: "test-password" })
        .expect(201)
    ).body;
    const token = (
      await request(app)
        .post("/api/sessions")
        .send({ profileId: profile.id, password: "test-password" })
        .expect(200)
    ).body.token;
    return { Authorization: `Bearer ${token}` };
  }
  headers = await user("Owner");
  otherHeaders = await user("Other");
  async function cycle(h, title) {
    return (
      await request(app)
        .post("/api/cycles")
        .set(h)
        .send({ title, startDate: "2026-10-19" })
        .expect(201)
    ).body;
  }
  draft = await cycle(headers, "삭제할 초안");
  retained = await cycle(headers, "유지할 초안");
  otherCycle = await cycle(otherHeaders, "다른 사용자");
});
after(() => pool.end());
test("only the owner can delete a draft at the confirmed version", async () => {
  await request(app)
    .delete(`/api/cycles/${draft.id}`)
    .send({ version: 0 })
    .expect(401);
  await request(app)
    .delete(`/api/cycles/${draft.id}`)
    .set(otherHeaders)
    .send({ version: 0 })
    .expect(404);
  await request(app)
    .delete(`/api/cycles/${draft.id}`)
    .set(headers)
    .send({})
    .expect(400);
  await request(app)
    .delete(`/api/cycles/${draft.id}`)
    .set(headers)
    .send({ version: 1 })
    .expect(409);
  assert.deepEqual(
    (await request(app).get(`/api/cycles/${draft.id}`).set(headers).expect(200))
      .body,
    draft,
  );
});
test("draft deletion removes its dependent history and conversations but preserves accounts, sessions and other cycles", async () => {
  const chat = randomUUID();
  await pool.query(
    "INSERT INTO ai_conversations(id,profile_id,cycle_id,title,provider,source) VALUES($1,$2,$3,'초안 대화','openai','native')",
    [chat, draft.profile_id, draft.id],
  );
  await pool.query(
    "INSERT INTO ai_vision_edits(id,cycle_id,profile_id,conversation_id,actor,before_text,after_text,from_version,to_version) VALUES($1,$2,$3,$4,'test','before','after',0,1)",
    [randomUUID(), draft.id, draft.profile_id, chat],
  );
  await pool.query(
    "INSERT INTO changes(profile_id,cycle_id,kind) VALUES($1,$2,'test')",
    [draft.profile_id, draft.id],
  );
  await pool.query(
    "INSERT INTO ai_vision_permissions(cycle_id,allow_write) VALUES($1,true)",
    [draft.id],
  );
  await request(app)
    .delete(`/api/cycles/${draft.id}`)
    .set(headers)
    .send({ version: 0 })
    .expect(204);
  for (const table of [
    "cycles",
    "ai_conversations",
    "ai_vision_edits",
    "changes",
    "ai_vision_permissions",
  ]) {
    const column = table === "cycles" ? "id" : "cycle_id";
    assert.equal(
      Number(
        (
          await pool.query(
            `SELECT count(*) AS n FROM ${table} WHERE ${column}=$1`,
            [draft.id],
          )
        ).rows[0].n,
      ),
      0,
    );
  }
  await request(app).get("/api/me").set(headers).expect(200);
  assert.deepEqual(
    (
      await request(app)
        .get(`/api/cycles/${retained.id}`)
        .set(headers)
        .expect(200)
    ).body,
    retained,
  );
  assert.deepEqual(
    (
      await request(app)
        .get(`/api/cycles/${otherCycle.id}`)
        .set(otherHeaders)
        .expect(200)
    ).body,
    otherCycle,
  );
  await request(app)
    .delete(`/api/cycles/${draft.id}`)
    .set(headers)
    .send({ version: 0 })
    .expect(404);
});
test("started, completed or execution-bearing cycles cannot be deleted", async () => {
  for (const status of ["active", "complete"]) {
    await pool.query("UPDATE cycles SET status=$1 WHERE id=$2", [
      status,
      retained.id,
    ]);
    await request(app)
      .delete(`/api/cycles/${retained.id}`)
      .set(headers)
      .send({ version: 0 })
      .expect(409);
  }
  await pool.query("UPDATE cycles SET status='draft' WHERE id=$1", [
    retained.id,
  ]);
  await pool.query(
    "INSERT INTO weeks(cycle_id,number,state) VALUES($1,1,'{}')",
    [retained.id],
  );
  await request(app)
    .delete(`/api/cycles/${retained.id}`)
    .set(headers)
    .send({ version: 0 })
    .expect(409);
  assert.equal(
    (await pool.query("SELECT * FROM weeks WHERE cycle_id=$1", [retained.id]))
      .rowCount,
    1,
  );
});
