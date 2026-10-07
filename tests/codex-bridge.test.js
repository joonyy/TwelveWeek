import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { createCodexBridge } from "../server/codex-bridge.js";
import { WebSocketServer } from "ws";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("Codex RPC resumes the selected real thread and uses schema-constrained read-only turns", async () => {
  const calls = [];
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const emit = (value) => child.stdout.write(JSON.stringify(value) + "\n");
    child.stdin = new Writable({
      write(chunk, encoding, done) {
        const c = JSON.parse(chunk.toString());
        calls.push(c);
        if (!c.method || c.id === undefined) {
          done();
          return;
        }
        const thread = {
          id: "saved-thread",
          turns: [
            {
              items: [
                {
                  type: "userMessage",
                  content: [{ type: "text", text: "과거의 생각" }],
                },
                { type: "agentMessage", text: "과거의 질문" },
              ],
            },
          ],
        };
        queueMicrotask(() => {
          emit(null);
          if (c.method === "thread/list")
            emit({
              id: c.id,
              result: { data: [{ id: thread.id, name: "과거 대화" }] },
            });
          else if (c.method.startsWith("thread/"))
            emit({ id: c.id, result: { thread } });
          else if (c.method === "turn/start") {
            emit({ id: c.id, result: { turn: { id: "turn" } } });
            emit({
              id: 700,
              method: "item/tool/call",
              params: { threadId: thread.id, name: "external-tool" },
            });
            emit({
              method: "item/completed",
              params: {
                threadId: thread.id,
                item: {
                  type: "agentMessage",
                  text: JSON.stringify({
                    message: "한 가지 더 생각해볼까요?",
                    vision: null,
                  }),
                },
              },
            });
            emit({
              method: "turn/completed",
              params: { threadId: thread.id, turn: { status: "completed" } },
            });
          } else emit({ id: c.id, result: {} });
        });
        done();
      },
    });
    child.kill = () => {
      child.stdout.end();
      child.emit("exit", 0);
    };
    return child;
  };
  const bridge = createCodexBridge({
    env: { CODEX_PROFILE_ID: "owner" },
    spawnImpl,
  });
  assert.ok(bridge.available("owner"));
  assert.ok(!bridge.available("other"));
  assert.equal((await bridge.list())[0].id, "saved-thread");
  assert.equal((await bridge.read("saved-thread"))[0].content, "과거의 생각");
  const result = await bridge.generate({
    threadId: "saved-thread",
    vision: "내 비전",
    messages: [{ role: "user", content: "계속 생각해줘" }],
    allowWrite: false,
  });
  assert.equal(result.threadId, "saved-thread");
  const resume = calls.find((c) => c.method === "thread/resume");
  assert.equal(resume.params.threadId, "saved-thread");
  // Codex 0.160.1's generated SandboxMode is kebab-case. SandboxPolicy is camel-case.
  assert.equal(resume.params.sandbox, "read-only");
  const turn = calls.find((c) => c.method === "turn/start");
  assert.equal(turn.params.sandboxPolicy.type, "readOnly");
  assert.equal(turn.params.outputSchema.additionalProperties, false);
  assert.match(turn.params.input[0].text, /장기비전/);
  const declinedTool = calls.find((c) => c.id === 700);
  assert.equal(declinedTool.result.success, false);
  assert.equal(declinedTool.result.contentItems[0].type, "inputText");
  bridge.close();
});

test("a failed Codex pipe rejects requests without crashing and reconnects", async () => {
  const children = [];
  const bridge = createCodexBridge({
    env: { CODEX_PROFILE_ID: "owner" },
    rpcTimeout: 1000,
    spawnImpl: () => {
      const child = new EventEmitter();
      children.push(child);
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new Writable({
        write(chunk, encoding, done) {
          const message = JSON.parse(chunk.toString());
          if (message.id)
            queueMicrotask(() => {
              if (message.method === "thread/list" && children.length === 1)
                child.stdin.emit(
                  "error",
                  Object.assign(new Error("broken pipe"), { code: "EPIPE" }),
                );
              else
                child.stdout.write(
                  JSON.stringify({
                    id: message.id,
                    result:
                      message.method === "thread/list" ? { data: [] } : {},
                  }) + "\n",
                );
            });
          done();
        },
      });
      child.kill = () => child.emit("exit", 0);
      return child;
    },
  });
  await assert.rejects(bridge.list(), { status: 502 });
  assert.deepEqual(await bridge.list(), []);
  children[0].emit("error", new Error("late exit"));
  assert.deepEqual(await bridge.list(), []);
  bridge.close();
});

test("managed Codex daemon reuses its writer, protects active turns and interrupts only its timed-out turn", async () => {
  const directory = await mkdtemp(join(tmpdir(), "twelve-codex-test-"));
  const socketPath = join(directory, "daemon.sock");
  const server = createServer();
  const wss = new WebSocketServer({ server });
  const calls = [];
  let busy = true,
    stall = false;
  wss.on("connection", (socket) =>
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString());
      calls.push(message);
      if (!message.id) return;
      const send = (event) => socket.send(JSON.stringify(event));
      if (message.method === "thread/read")
        send({
          id: message.id,
          result: {
            thread: { id: "saved", status: { type: busy ? "active" : "idle" } },
          },
        });
      else if (message.method === "thread/resume")
        send({ id: message.id, result: { thread: { id: "saved" } } });
      else if (message.method === "turn/start") {
        send({ id: message.id, result: { turn: { id: "own-turn" } } });
        if (!stall) {
          send({
            method: "item/completed",
            params: {
              threadId: "saved",
              item: {
                type: "agentMessage",
                text: JSON.stringify({
                  message: "다시 연결됐어요.",
                  vision: null,
                }),
              },
            },
          });
          send({
            method: "turn/completed",
            params: {
              threadId: "saved",
              turn: { id: "own-turn", status: "completed" },
            },
          });
        }
      } else
        send({
          id: message.id,
          result: message.method === "thread/list" ? { data: [] } : {},
        });
    }),
  );
  await new Promise((resolve) => server.listen(socketPath, resolve));
  const bridge = createCodexBridge({
    env: { CODEX_PROFILE_ID: "owner", CODEX_SOCKET_PATH: socketPath },
    turnTimeout: 250,
  });
  const args = {
    threadId: "saved",
    vision: "내 비전",
    allowWrite: false,
    messages: [{ role: "user", content: "검토해줘" }],
  };
  try {
    await assert.rejects(bridge.generate(args), { status: 409 });
    assert.ok(
      !calls.some(
        (m) => m.method === "thread/resume" || m.method === "turn/start",
      ),
    );
    busy = false;
    assert.equal((await bridge.generate(args)).message, "다시 연결됐어요.");
    assert.equal(
      calls.find((m) => m.method === "thread/resume").params.sandbox,
      undefined,
    );
    stall = true;
    await assert.rejects(bridge.generate(args), { status: 502 });
    assert.deepEqual(await bridge.list(), []);
    const interrupt = calls.find((m) => m.method === "turn/interrupt");
    assert.equal(interrupt.params.threadId, "saved");
    assert.equal(interrupt.params.turnId, "own-turn");
  } finally {
    bridge.close();
    for (const socket of wss.clients) socket.terminate();
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
