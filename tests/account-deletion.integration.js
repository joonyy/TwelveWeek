import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { createPool } from "../server/db.js";
import { migrate } from "../server/migrate.js";
import { deleteProfileData } from "../server/accounts.js";
import { createApp } from "../server/app.js";
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("Use a dedicated _test database");
const pool = createPool(url);
const app = createApp({ pool, rateLimits: false });
const password = "account-test-password";
let owner, other;
const tables = {
  profiles: "id",
  sessions: "profile_id",
  cycles: "profile_id",
  weeks: "cycle_id",
  changes: "profile_id",
  ai_connections: "profile_id",
  ai_conversations: "profile_id",
  ai_vision_permissions: "cycle_id",
  ai_vision_edits: "profile_id",
  ai_oauth_codes: "profile_id",
  ai_oauth_tokens: "profile_id",
  calendar_connections: "profile_id",
  calendar_previews: "profile_id",
};
async function snapshot(user, db = pool) {
  const result = {};
  for (const [table, column] of Object.entries(tables))
    result[table] = (
      await db.query(
        `SELECT * FROM ${table} WHERE ${column}=$1 ORDER BY to_jsonb(${table})::text`,
        [column === "cycle_id" ? user.cycle.id : user.profile.id],
      )
    ).rows;
  return result;
}
before(async () => {
  await migrate(pool);
  await pool.query(
    "TRUNCATE changes,weeks,cycles,sessions,profiles RESTART IDENTITY CASCADE",
  );
  const clientId = `account-client-${randomUUID()}`;
  await pool.query(
    "INSERT INTO ai_oauth_clients(id,name,redirect_uris) VALUES($1,'Shared test client','[]')",
    [clientId],
  );
  async function fixture(name) {
    const profile = (
      await request(app)
        .post("/api/profiles")
        .send({ name, password })
        .expect(201)
    ).body;
    const token = (
      await request(app)
        .post("/api/sessions")
        .send({ profileId: profile.id, password })
        .expect(200)
    ).body.token;
    const secondToken = (
      await request(app)
        .post("/api/sessions")
        .send({ profileId: profile.id, password })
        .expect(200)
    ).body.token;
    const cycle = (
      await request(app)
        .post("/api/cycles")
        .set("Authorization", `Bearer ${token}`)
        .send({ title: "기록", startDate: "2026-10-19" })
        .expect(201)
    ).body;
    const id = profile.id,
      cid = cycle.id,
      chat = randomUUID();
    await pool.query(
      "INSERT INTO weeks(cycle_id,number,state) VALUES($1,1,$2)",
      [
        cid,
        JSON.stringify({
          occurrences: [
            {
              id: "reading",
              completed: true,
              readingRecord: { chapter: "1장", thought: "남길 생각" },
            },
          ],
          review: "회고",
        }),
      ],
    );
    await pool.query(
      "INSERT INTO changes(profile_id,cycle_id,kind) VALUES($1,$2,'test')",
      [id, cid],
    );
    await pool.query(
      "INSERT INTO ai_connections(profile_id,provider,model,secret_cipher) VALUES($1,'openai','test','test-cipher')",
      [id],
    );
    await pool.query(
      "INSERT INTO ai_conversations(id,profile_id,cycle_id,title,provider,source) VALUES($1,$2,$3,'대화','openai','native')",
      [chat, id, cid],
    );
    await pool.query(
      "INSERT INTO ai_vision_permissions(cycle_id,allow_write) VALUES($1,true)",
      [cid],
    );
    await pool.query(
      "INSERT INTO ai_vision_edits(id,cycle_id,profile_id,conversation_id,actor,before_text,after_text,from_version,to_version) VALUES($1,$2,$3,$4,'test','before','after',0,1)",
      [randomUUID(), cid, id, chat],
    );
    await pool.query(
      "INSERT INTO ai_oauth_codes(code_hash,client_id,profile_id,cycle_id,redirect_uri,challenge,scope,resource,expires_at) VALUES($1,$2,$3,$4,'https://example.test','challenge','read','test',now()+interval '1 day')",
      [randomUUID(), clientId, id, cid],
    );
    await pool.query(
      "INSERT INTO ai_oauth_tokens(token_hash,refresh_hash,profile_id,cycle_id,client_id,scope,resource,expires_at,refresh_expires_at,grant_id) VALUES($1,$2,$3,$4,$5,'read','test',now()+interval '1 day',now()+interval '2 days',$6)",
      [randomUUID(), randomUUID(), id, cid, clientId, randomUUID()],
    );
    await pool.query(
      "INSERT INTO calendar_connections(profile_id,username,secret_cipher) VALUES($1,'test','test-cipher')",
      [id],
    );
    await pool.query(
      "INSERT INTO calendar_previews(id,profile_id,cycle_id,payload,expires_at) VALUES($1,$2,$3,'{}',now()+interval '1 day')",
      [randomUUID(), id, cid],
    );
    return { profile, token, secondToken, cycle };
  }
  owner = await fixture("삭제할 계정");
  other = await fixture("보존할 계정");
});
after(() => pool.end());

test("account deletion requires authentication, the current password and the authenticated account name", async () => {
  const before = await snapshot(owner);
  await request(app)
    .delete("/api/me")
    .send({ currentPassword: password, confirmationName: owner.profile.name })
    .expect(401);
  const headers = { Authorization: `Bearer ${owner.token}` };
  await request(app).delete("/api/me").set(headers).send({}).expect(400);
  await request(app)
    .delete("/api/me")
    .set(headers)
    .send({
      profileId: other.profile.id,
      currentPassword: password,
      confirmationName: other.profile.name,
    })
    .expect(400);
  await request(app)
    .delete("/api/me")
    .set(headers)
    .send({ currentPassword: "wrong", confirmationName: owner.profile.name })
    .expect(400);
  assert.deepEqual(await snapshot(owner), before);
});

test("deleting all account data is transactional and can be rolled back without partial loss", async () => {
  const before = await snapshot(owner),
    db = await pool.connect();
  try {
    await db.query("BEGIN");
    assert.equal(await deleteProfileData(db, owner.profile.id), true);
    for (const rows of Object.values(await snapshot(owner, db)))
      assert.equal(rows.length, 0);
    await db.query("ROLLBACK");
  } finally {
    db.release();
  }
  assert.deepEqual(await snapshot(owner), before);
});

test("deletion removes every owned record and token while preserving other accounts and shared OAuth clients", async () => {
  const before = await snapshot(other);
  const clients = (
    await pool.query("SELECT * FROM ai_oauth_clients ORDER BY id")
  ).rows;
  await request(app)
    .delete("/api/me")
    .set("Authorization", `Bearer ${owner.token}`)
    .send({
      profileId: other.profile.id,
      currentPassword: password,
      confirmationName: owner.profile.name,
    })
    .expect(204);
  for (const rows of Object.values(await snapshot(owner)))
    assert.equal(rows.length, 0);
  assert.deepEqual(await snapshot(other), before);
  assert.deepEqual(
    (await pool.query("SELECT * FROM ai_oauth_clients ORDER BY id")).rows,
    clients,
  );
  for (const token of [owner.token, owner.secondToken])
    await request(app)
      .get("/api/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(401);
  await request(app)
    .post("/api/sessions")
    .send({ name: owner.profile.name, password })
    .expect(401);
  assert.equal(
    (await request(app).get("/api/profiles").expect(200)).body.some(
      (p) => p.id === owner.profile.id,
    ),
    false,
  );
});

test("incorrect account-deletion passwords are rate limited without blocking ordinary authenticated reads", async () => {
  const limited = createApp({ pool, rateLimits: true }),
    headers = { Authorization: `Bearer ${other.token}` };
  for (let i = 0; i < 10; i++)
    await request(limited)
      .delete("/api/me")
      .set(headers)
      .send({ currentPassword: "wrong", confirmationName: other.profile.name })
      .expect(400);
  await request(limited)
    .delete("/api/me")
    .set(headers)
    .send({ currentPassword: "wrong", confirmationName: other.profile.name })
    .expect(429);
  await request(limited).get("/api/me").set(headers).expect(200);
});
