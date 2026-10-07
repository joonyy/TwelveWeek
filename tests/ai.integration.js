import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import request from "supertest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createPool } from "../server/db.js";
import { migrate } from "../server/migrate.js";
import { createApp } from "../server/app.js";
import { emptyPlan } from "../shared/domain.js";
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("AI tests require a dedicated _test database");
const pool = createPool(url);
let delayed, started, release, failNext;
const aiProvider = {
  available: () => true,
  model: () => "test-model",
  async generate({ messages }) {
    if (failNext) {
      failNext = false;
      throw Object.assign(new Error("AI 응답 실패 시험"), { status: 502 });
    }
    if (delayed) {
      started();
      await new Promise((r) => {
        release = r;
      });
    }
    const message = messages.at(-1).content;
    return {
      message: "누구의 삶에 어떤 변화가 생기길 바라나요?",
      vision: message.includes("반영")
        ? "나와 같은 어려움을 겪는 사람에게 선택의 길을 보여주는 삶"
        : null,
    };
  },
};
const fakeCodex = {
  available: () => true,
  list: async () => [{ id: "local-thread", title: "기존 비전 대화" }],
  read: async () => [
    { role: "user", content: "기존 생각" },
    { role: "assistant", content: "어떤 삶?" },
  ],
  generate: async () => ({
    message: "이어서 생각해볼까요?",
    vision: null,
    threadId: "local-thread",
  }),
};
const app = createApp({
  pool,
  now: () => new Date("2026-10-07T03:00:00Z"),
  rateLimits: false,
  aiProvider,
  codex: fakeCodex,
  aiEnv: {
    AI_SECRETS_KEY: "test-only-key".repeat(4),
    API_PUBLIC_URL: "http://127.0.0.1:4111",
    WEB_PUBLIC_URL: "http://127.0.0.1:5179",
  },
});
let owner,
  other,
  cycle,
  chat,
  access,
  refresh,
  connectionId,
  server,
  oauthClientId;
const call = (method, path, body, who = owner) => {
  let r = request(app)
    [method](`/api${path}`)
    .set("Authorization", `Bearer ${who}`);
  return body ? r.send(body) : r;
};
const prefix = () => `/ai/cycles/${cycle.id}`;
const turn = (message) =>
  call("post", `${prefix()}/conversations/${chat.id}/messages`, {
    message,
    requestId: randomUUID(),
    version: chat.version,
    cycleVersion: cycle.version,
  });
const update = async (message) => {
  const r = await turn(message).expect(200);
  chat = r.body.conversation;
  cycle = r.body.cycle;
  return r.body;
};
before(async () => {
  await migrate(pool);
  await pool.query(
    "TRUNCATE profiles,cycles,weeks,changes,sessions RESTART IDENTITY CASCADE",
  );
  const p = (
    await request(app).post("/api/profiles").send({ name: "AI 소유자" })
  ).body;
  owner = (await request(app).post("/api/sessions").send({ profileId: p.id }))
    .body.token;
  const p2 = (
    await request(app).post("/api/profiles").send({ name: "다른 사용자" })
  ).body;
  other = (await request(app).post("/api/sessions").send({ profileId: p2.id }))
    .body.token;
  const plan = emptyPlan();
  plan.longVision = "처음 비전";
  plan.personalVision = "3년 뒤 생활";
  cycle = (
    await call("post", "/cycles", {
      title: "AI 비전",
      startDate: "2026-10-12",
      plan,
    }).expect(201)
  ).body;
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await pool.end();
});
test("failed AI requests keep the server and question, and retry without duplicating it", async () => {
  const retryCycle = (
    await call("post", "/cycles", {
      title: "재시도 시험",
      startDate: "2026-10-12",
      plan: emptyPlan(),
    }).expect(201)
  ).body;
  const retryPrefix = `/ai/cycles/${retryCycle.id}`;
  const c = (
    await call("post", `${retryPrefix}/conversations`, {
      provider: "openai",
    }).expect(201)
  ).body;
  const body = {
    message: "저장된 질문",
    requestId: randomUUID(),
    version: c.version,
    cycleVersion: retryCycle.version,
  };
  failNext = true;
  await call(
    "post",
    `${retryPrefix}/conversations/${c.id}/messages`,
    body,
  ).expect(502);
  await request(app).get("/api/health").expect(200);
  const saved = (
    await call("get", `${retryPrefix}/conversations/${c.id}`).expect(200)
  ).body;
  assert.equal(saved.busy, false);
  assert.equal(saved.messages.length, 1);
  assert.equal(saved.messages[0].requestId, body.requestId);
  const result = (
    await call("post", `${retryPrefix}/conversations/${c.id}/messages`, {
      ...body,
      version: saved.version,
    }).expect(200)
  ).body;
  assert.equal(result.conversation.messages.length, 2);
  assert.equal(
    result.conversation.messages.filter((m) => m.role === "user").length,
    1,
  );
  await call(
    "post",
    `${retryPrefix}/conversations/${c.id}/messages`,
    body,
  ).expect(200);
  assert.equal(
    (await call("get", `${retryPrefix}/conversations/${c.id}`)).body.messages
      .length,
    2,
  );
});
test("AI private settings, keys and owner scope", async () => {
  await call("put", "/ai/connections/openai", {
    key: "test-api-key-not-real",
    model: "test-user-model",
  }).expect(200);
  const config = (await call("get", "/ai/config")).body;
  assert.ok(config.providers.find((p) => p.provider === "openai").personal);
  assert.ok(!JSON.stringify(config).includes("test-api-key"));
  const stored = (await pool.query("SELECT secret_cipher FROM ai_connections"))
    .rows[0].secret_cipher;
  assert.ok(!stored.includes("test-api-key"));
  await call("get", `${prefix()}/context`, null, other).expect(404);
  await call(
    "put",
    `${prefix()}/permission`,
    { allowWrite: true },
    other,
  ).expect(404);
  await call("get", `${prefix()}/edits`, null, other).expect(404);
});
test("conversation import persists across reload, question does not finalize vision", async () => {
  chat = (
    await call("post", `${prefix()}/conversations`, {
      provider: "openai",
      transcript: JSON.stringify([
        { role: "user", content: "과거의 생각" },
        { role: "assistant", content: "과거의 질문" },
      ]),
      sourceLabel: "ChatGPT",
    }).expect(201)
  ).body;
  assert.equal(chat.source, "import");
  await call("get", `${prefix()}/conversations/${chat.id}`, null, other).expect(
    404,
  );
  await update("질문 하나 해줘");
  assert.equal(cycle.plan.longVision, "처음 비전");
  assert.equal(
    (await call("get", `${prefix()}/conversations/${chat.id}`)).body.messages
      .length,
    4,
  );
  assert.equal(
    (await call("get", `${prefix()}/conversations`)).body[0].id,
    chat.id,
  );
});
test("permission is enforced and explicit acceptance/undo preserve unrelated planning", async () => {
  const untouched = structuredClone(cycle.plan);
  await update("비전에 반영해줘");
  assert.equal(cycle.plan.longVision, "처음 비전");
  assert.equal(chat.messages.at(-1).applied, false);
  const accepted = (
    await call("post", `${prefix()}/vision`, {
      version: cycle.version,
      vision: chat.messages.at(-1).proposedVision,
    }).expect(200)
  ).body;
  cycle = accepted.cycle;
  assert.equal(cycle.plan.personalVision, untouched.personalVision);
  assert.deepEqual(cycle.plan.goals, untouched.goals);
  cycle = (
    await call("post", `${prefix()}/edits/${accepted.edit.id}/undo`, {
      version: cycle.version,
    }).expect(200)
  ).body;
  assert.equal(cycle.plan.longVision, "처음 비전");
  await call("put", `${prefix()}/permission`, { allowWrite: true }).expect(200);
  await update("이번엔 비전에 반영해줘");
  assert.equal(chat.messages.at(-1).applied, true);
  assert.equal(
    cycle.plan.longVision,
    "나와 같은 어려움을 겪는 사람에게 선택의 길을 보여주는 삶",
  );
  const history = (await call("get", `${prefix()}/edits`)).body;
  await call(
    "post",
    `${prefix()}/edits/${history[0].id}/undo`,
    { version: cycle.version },
    other,
  ).expect(404);
  await call("post", `${prefix()}/vision`, {
    version: cycle.version - 1,
    vision: "낡은 수정",
  }).expect(409);
  await call("post", `${prefix()}/vision`, {
    version: cycle.version,
    vision: "수정",
    goals: [],
  }).expect(400);
});
test("revocation during AI response leaves a proposal and duplicate turns are rejected", async () => {
  delayed = true;
  const waitStarted = new Promise((r) => {
    started = r;
  });
  const response = turn("반영해줘").then((r) => r);
  await waitStarted;
  await turn("중복 요청").expect(409);
  await call("put", `${prefix()}/permission`, { allowWrite: false }).expect(
    200,
  );
  release();
  const r = await response;
  assert.equal(r.status, 200);
  chat = r.body.conversation;
  cycle = r.body.cycle;
  assert.equal(chat.messages.at(-1).applied, false);
  assert.match(chat.messages.at(-1).warning, /철회/);
  delayed = false;
});
test("Codex adapter reopens selected stored thread without pretending import is resume", async () => {
  assert.equal(
    (await call("get", "/ai/codex/threads")).body[0].id,
    "local-thread",
  );
  const c = (
    await call("post", `${prefix()}/conversations`, {
      provider: "codex",
      remoteThreadId: "local-thread",
    }).expect(201)
  ).body;
  assert.equal(c.source, "codex");
  assert.equal(c.messages.length, 2);
  const r = (
    await call("post", `${prefix()}/conversations/${c.id}/messages`, {
      message: "계속",
      requestId: randomUUID(),
      version: c.version,
      cycleVersion: cycle.version,
    }).expect(200)
  ).body;
  assert.equal(r.conversation.remote_thread_id, "local-thread");
  assert.equal(r.conversation.messages.at(-1).content, "이어서 생각해볼까요?");
});
test("OAuth discovery, exact redirect binding, S256 PKCE and one-use codes", async () => {
  const resource = "http://127.0.0.1:4111/mcp",
    redirect = "https://example.com/callback";
  const metadata = (
    await request(app).get("/.well-known/oauth-authorization-server")
  ).body;
  assert.deepEqual(metadata.code_challenge_methods_supported, ["S256"]);
  const client = (
    await request(app)
      .post("/oauth/register")
      .send({ client_name: "SDK 테스트", redirect_uris: [redirect] })
      .expect(201)
  ).body;
  oauthClientId = client.client_id;
  await request(app)
    .post("/oauth/register")
    .send({ redirect_uris: ["http://evil.example/callback"] })
    .expect(400);
  const verifier = randomBytes(32).toString("base64url");
  const params = {
    client_id: client.client_id,
    redirect_uri: redirect,
    response_type: "code",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    scope: "vision:read vision:write",
    resource,
    state: "preserved-state",
  };
  await call("post", "/ai/oauth/preview", {
    ...params,
    redirect_uri: "https://evil.example",
  }).expect(400);
  const approval = (
    await call("post", "/ai/oauth/approve", {
      ...params,
      cycleId: cycle.id,
    }).expect(200)
  ).body;
  const returned = new URL(approval.redirect);
  assert.equal(returned.searchParams.get("state"), params.state);
  const tokenInput = {
    grant_type: "authorization_code",
    client_id: client.client_id,
    redirect_uri: redirect,
    resource,
    code: returned.searchParams.get("code"),
    code_verifier: verifier,
  };
  await request(app)
    .post("/oauth/token")
    .type("form")
    .send({ ...tokenInput, code_verifier: "x".repeat(43) })
    .expect(400);
  const tokens = (
    await request(app)
      .post("/oauth/token")
      .type("form")
      .send(tokenInput)
      .expect(200)
  ).body;
  access = tokens.access_token;
  refresh = tokens.refresh_token;
  await request(app)
    .post("/oauth/token")
    .type("form")
    .send(tokenInput)
    .expect(400);
  connectionId = (await call("get", "/ai/mcp")).body.connections[0].id;
  await call("get", "/ai/mcp", null, other)
    .expect(200)
    .then((r) => assert.equal(r.body.connections.length, 0));
});
test("OAuth refresh rotates secrets but keeps a revocable connection identity", async () => {
  const previousAccess = access,
    previousRefresh = refresh;
  const body = {
    grant_type: "refresh_token",
    client_id: oauthClientId,
    refresh_token: previousRefresh,
    resource: "http://127.0.0.1:4111/mcp",
  };
  const result = (
    await request(app).post("/oauth/token").type("form").send(body).expect(200)
  ).body;
  access = result.access_token;
  refresh = result.refresh_token;
  assert.notEqual(access, previousAccess);
  assert.notEqual(refresh, previousRefresh);
  await request(app)
    .post("/mcp")
    .set("Authorization", `Bearer ${previousAccess}`)
    .send({})
    .expect(401);
  await request(app).post("/oauth/token").type("form").send(body).expect(400);
  assert.equal(
    (await call("get", "/ai/mcp")).body.connections[0].id,
    connectionId,
  );
});
test("real MCP SDK handshake, scoped tools, permission, live updates and revoke", async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const url = new URL(`http://127.0.0.1:${server.address().port}/mcp`);
  await request(app).post("/mcp").send({}).expect(401);
  const client = new Client({ name: "integration-test", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { Authorization: `Bearer ${access}` } },
    }),
  );
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 2);
  const current = await client.callTool({
    name: "read_long_vision",
    arguments: {},
  });
  assert.equal(current.structuredContent.cycleId, cycle.id);
  const blocked = await client.callTool({
    name: "update_long_vision",
    arguments: { version: cycle.version, vision: "MCP 비전" },
  });
  assert.ok(blocked.isError);
  await call("put", `${prefix()}/permission`, { allowWrite: true }).expect(200);
  const edited = await client.callTool({
    name: "update_long_vision",
    arguments: { version: cycle.version, vision: "MCP 비전" },
  });
  assert.equal(edited.structuredContent.longVision, "MCP 비전");
  cycle = (await call("get", `/cycles/${cycle.id}`)).body;
  assert.equal(cycle.plan.longVision, "MCP 비전");
  await call("delete", `/ai/mcp/${connectionId}`).expect(204);
  await assert.rejects(
    client.callTool({ name: "read_long_vision", arguments: {} }),
  );
  await request(app)
    .post("/oauth/token")
    .type("form")
    .send({
      grant_type: "refresh_token",
      client_id: oauthClientId,
      refresh_token: refresh,
      resource: "http://127.0.0.1:4111/mcp",
    })
    .expect(400);
  await client.close();
});
