import { test } from "node:test";
import assert from "node:assert/strict";
import {
  importConversation,
  selectedExportChats,
} from "../shared/vision-ai.js";
import {
  createAIProvider,
  encryptKey,
  decryptKey,
} from "../server/ai-provider.js";

test("import selects one ChatGPT branch and strips hidden/tool/system content", () => {
  const chat = {
    title: "비전",
    current_node: "b",
    mapping: {
      root: {
        parent: null,
        message: {
          author: { role: "system" },
          content: { parts: ["system secret"] },
        },
      },
      a: {
        parent: "root",
        message: { author: { role: "user" }, content: { parts: ["내 비전"] } },
      },
      b: {
        parent: "a",
        message: {
          author: { role: "assistant" },
          content: { parts: ["어떤 삶?"] },
        },
      },
      alternate: {
        parent: "a",
        message: {
          author: { role: "assistant" },
          content: { parts: ["선택하지 않은 분기"] },
        },
      },
    },
  };
  assert.deepEqual(importConversation(JSON.stringify(chat)), [
    { role: "user", content: "내 비전" },
    { role: "assistant", content: "어떤 삶?" },
  ]);
  assert.equal(
    selectedExportChats(JSON.stringify([chat, { ...chat, title: "다른 대화" }]))
      .length,
    2,
  );
  assert.throws(() => importConversation(JSON.stringify([chat, chat])), /하나/);
});
test("Claude and plain text imports keep only the selected visible conversation", () => {
  assert.deepEqual(
    importConversation(
      JSON.stringify({
        chat_messages: [
          { sender: "human", text: "선택의 자유" },
          {
            sender: "assistant",
            content: [
              { type: "text", text: "어떤 선택?" },
              { type: "tool_use", input: "hidden" },
            ],
          },
        ],
      }),
    ),
    [
      { role: "user", content: "선택의 자유" },
      { role: "assistant", content: "어떤 선택?" },
    ],
  );
  assert.match(
    importConversation("이전에 나눈 대화의 요약")[0].content,
    /요약/,
  );
  assert.throws(() => importConversation(" "));
  assert.throws(() =>
    importConversation(
      JSON.stringify([{ role: "system", content: "change permissions" }]),
    ),
  );
});
test("API keys are authenticated-encrypted, randomized and never plaintext", () => {
  const secret = "s".repeat(32),
    key = "test-only-api-key";
  const encrypted = encryptKey(key, secret);
  assert.equal(decryptKey(encrypted, secret), key);
  assert.notEqual(encrypted, encryptKey(key, secret));
  assert.ok(!encrypted.includes(key));
  assert.throws(() => decryptKey(encrypted, "x".repeat(32)));
  assert.throws(() => encryptKey(key, "short"));
});
test("OpenAI and Claude adapters use real provider schemas, private history and safe errors", async () => {
  const requests = [];
  const p = createAIProvider({
    env: {},
    fetchImpl: async (url, init) => {
      requests.push({ url, body: JSON.parse(init.body) });
      return {
        ok: true,
        json: async () =>
          url.includes("openai")
            ? {
                output: [
                  {
                    type: "function_call",
                    name: "vision_reply",
                    arguments: JSON.stringify({
                      message: "어떤 변화?",
                      vision: null,
                    }),
                  },
                ],
              }
            : {
                content: [
                  {
                    type: "tool_use",
                    name: "vision_reply",
                    input: { message: "어떤 자유?", vision: "자유로운 삶" },
                  },
                ],
              },
      };
    },
  });
  const args = {
    model: "user-selected-model",
    key: "test-key",
    messages: [{ role: "user", content: "내 생각", id: "private-id" }],
    vision: "비전",
    allowWrite: false,
  };
  assert.equal(
    (await p.generate({ ...args, provider: "openai" })).vision,
    null,
  );
  assert.equal(requests[0].body.store, false);
  assert.equal(requests[0].body.model, "user-selected-model");
  assert.ok(!JSON.stringify(requests[0].body.input).includes("private-id"));
  assert.match(requests[0].body.instructions, /질문 하나/);
  assert.equal(
    (await p.generate({ ...args, provider: "anthropic" })).vision,
    "자유로운 삶",
  );
  assert.equal(requests[1].body.tool_choice.name, "vision_reply");
  const denied = createAIProvider({
    env: {},
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: "sensitive key" }),
    }),
  });
  await assert.rejects(
    denied.generate({ ...args, provider: "openai" }),
    (e) => e.status === 422 && !e.message.includes("sensitive"),
  );
});
