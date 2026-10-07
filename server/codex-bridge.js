import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import WebSocket from "ws";
import { VISION_GUIDANCE, VISION_REPLY_SCHEMA } from "../shared/vision-ai.js";
import { failAI } from "./vision-service.js";
import { replySchema } from "./ai-provider.js";

// The managed daemon owns threads open in the Codex app. Rejoin that process
// over its local Unix WebSocket instead of attempting to acquire a second writer.
function connectDaemon(socketPath) {
  const socket = new WebSocket(`ws+unix://${socketPath}:/`, {
    handshakeTimeout: 10000,
    maxPayload: 32 * 1024 * 1024,
  });
  const client = new EventEmitter();
  client.stdout = new PassThrough();
  client.stderr = new PassThrough();
  client.stdin = new Writable({
    write(chunk, encoding, done) {
      const send = () => {
        if (socket.readyState !== WebSocket.OPEN)
          return done(
            Object.assign(new Error("Codex socket closed"), { code: "EPIPE" }),
          );
        socket.send(chunk.toString().trimEnd(), done);
      };
      if (socket.readyState === WebSocket.CONNECTING) socket.once("open", send);
      else send();
    },
  });
  socket.on("message", (data) => client.stdout.write(data.toString() + "\n"));
  socket.on("error", (error) => client.emit("error", error));
  socket.on("close", () => {
    client.stdout.end();
    client.emit("exit");
  });
  client.kill = () => socket.terminate(); // Disconnect our client; never stop the daemon.
  return client;
}

// Opt-in, one local profile. Never expose the host's thread store to all users.
export function createCodexBridge({
  env = process.env,
  spawnImpl = spawn,
  rpcTimeout = 15000,
  turnTimeout = 120000,
} = {}) {
  let child,
    ready,
    sequence = 0,
    root,
    activeTurn = null,
    turnBusy = false;
  const pending = new Map();
  const rpc = (method, params, timeout = rpcTimeout) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(
          Object.assign(new Error("Codex 연결 응답이 늦어지고 있어요."), {
            status: 502,
          }),
        );
      }, timeout);
      pending.set(id, {
        method,
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      try {
        if (!child || child.stdin.destroyed || child.stdin.writableEnded)
          throw new Error("Codex stream closed");
        child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
      } catch {
        const p = pending.get(id);
        pending.delete(id);
        p.reject(
          Object.assign(new Error("Codex 연결이 끊어졌어요."), { status: 502 }),
        );
      }
    });
  const reset = () => {
    for (const p of pending.values())
      p.reject(
        Object.assign(new Error("Codex 연결이 끊어졌어요."), { status: 502 }),
      );
    pending.clear();
    activeTurn?.reject(
      Object.assign(new Error("Codex 대화를 이어가지 못했어요."), {
        status: 502,
      }),
    );
    activeTurn = null;
    child = null;
    ready = null;
  };
  const start = async () => {
    if (ready) return ready;
    ready = (async () => {
      root ||= await mkdtemp(join(tmpdir(), "twelveweek-codex-"));
      child = env.CODEX_SOCKET_PATH
        ? connectDaemon(env.CODEX_SOCKET_PATH)
        : spawnImpl(
            env.CODEX_BIN || "codex",
            ["app-server", "--listen", "stdio://", "-c", "mcp_servers={}"],
            {
              stdio: ["pipe", "pipe", "pipe"],
              env: { ...process.env, ...env },
            },
          );
      const ownedChild = child;
      const disconnect = () => {
        if (child !== ownedChild) return;
        reset();
        ownedChild.kill();
      };
      child.on("error", disconnect);
      child.once("exit", disconnect);
      child.stdin.on("error", disconnect);
      child.stdout.on("error", disconnect);
      child.stderr.on("data", () => {}); // Never log prompts, tokens or private host paths.
      createInterface({ input: child.stdout }).on("line", (line) => {
        if (child !== ownedChild) return;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }
        if (!event || typeof event !== "object") return;
        if (event.id !== undefined && !event.method) {
          const p = pending.get(event.id);
          if (!p) return;
          pending.delete(event.id);
          if (event.error) console.warn("[Codex RPC error]", event.error.code);
          return event.error
            ? p.reject(
                Object.assign(
                  new Error(
                    "Codex 요청을 처리하지 못했어요. 저장된 대화와 로컬 로그인을 확인해주세요.",
                  ),
                  {
                    status: /active writer/.test(event.error.message)
                      ? 409
                      : 502,
                    rpcMethod: p.method,
                    rpcCode: event.error.code,
                    rpcMessage: event.error.message,
                  },
                ),
              )
            : p.resolve(event.result);
        }
        if (event.id !== undefined && typeof event.method === "string") {
          if (
            env.CODEX_SOCKET_PATH &&
            (!activeTurn ||
              (event.params?.threadId &&
                event.params.threadId !== activeTurn.threadId))
          )
            return;
          // Read-only host: deny commands and permission escalation; UI changes are applied by our service.
          const response =
            event.method === "item/tool/call"
              ? {
                  contentItems: [
                    {
                      type: "inputText",
                      text: "TwelveWeek는 전달된 비전을 다듬는 대화만 지원합니다. 외부 도구를 실행하지 말고 현재 비전으로 답해주세요.",
                    },
                  ],
                  success: false,
                }
              : event.method === "item/permissions/requestApproval"
                ? { permissions: {}, scope: "turn" }
                : event.method.includes("requestUserInput")
                  ? { answers: {} }
                  : event.method.includes("elicitation")
                    ? { action: "decline", content: null }
                    : { decision: "decline" };
          child?.stdin.write(
            JSON.stringify({ id: event.id, result: response }) + "\n",
          );
          return;
        }
        if (!activeTurn || event.params?.threadId !== activeTurn.threadId)
          return;
        if (event.method === "turn/started")
          activeTurn.turnId = event.params.turn?.id;
        if (
          event.method === "item/completed" &&
          event.params.item?.type === "agentMessage"
        )
          activeTurn.text = event.params.item.text;
        if (event.method === "turn/completed") {
          const current = activeTurn;
          activeTurn = null;
          if (event.params.turn?.status !== "completed")
            current.reject(
              Object.assign(
                new Error(
                  "Codex 응답이 완료되지 않았어요. 비전은 변경하지 않았어요.",
                ),
                { status: 502 },
              ),
            );
          else current.resolve(current.text);
        }
      });
      await rpc("initialize", {
        clientInfo: {
          name: "twelveweek",
          title: "TwelveWeek Vision",
          version: "0.2.0",
        },
        capabilities: { experimentalApi: true },
      });
      child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
    })();
    const initialization = ready;
    try {
      return await initialization;
    } catch (error) {
      if (ready === initialization) reset();
      throw error;
    }
  };
  return {
    available(profileId) {
      return (
        !!env.CODEX_PROFILE_ID &&
        env.CODEX_PROFILE_ID === profileId &&
        env.NODE_ENV !== "production"
      );
    },
    async list() {
      await start();
      const page = await rpc("thread/list", {
        limit: 50,
        sourceKinds: ["cli", "vscode", "appServer"],
        archived: false,
      });
      return (page.data || []).map(({ id, name, preview, status }) => ({
        id,
        title: name || preview?.slice(0, 100) || "Codex 대화",
        busy: status?.type === "active",
      }));
    },
    async read(threadId) {
      await start();
      const { thread } = await rpc("thread/read", {
        threadId,
        includeTurns: true,
      });
      return (thread.turns || [])
        .flatMap((turn) =>
          (turn.items || []).flatMap((item) => {
            if (item.type === "userMessage")
              return [
                {
                  role: "user",
                  content: (item.content || [])
                    .filter((p) => p.type === "text")
                    .map((p) => p.text)
                    .join("\n"),
                },
              ];
            if (item.type === "agentMessage")
              return [{ role: "assistant", content: item.text }];
            return [];
          }),
        )
        .filter((m) => m.content)
        .slice(-100);
    },
    async generate({
      threadId,
      messages,
      vision,
      allowWrite,
      ephemeral = false,
    }) {
      if (turnBusy) failAI(409, "로컬 Codex가 다른 응답을 처리하고 있어요.");
      turnBusy = true;
      try {
        await start();
        if (threadId) {
          const { thread } = await rpc("thread/read", {
            threadId,
            includeTurns: false,
          });
          if (thread.status?.type === "active")
            failAI(
              409,
              "이 Codex 대화가 원래 화면에서 응답 중이에요. 응답이 끝난 뒤 저장된 질문을 다시 보내주세요.",
            );
        }
        const overrides = {
          cwd: root,
          approvalPolicy: "untrusted",
          sandbox: "read-only",
          baseInstructions: VISION_GUIDANCE,
          config: { mcp_servers: {} },
        };
        const hadThread = !!threadId;
        const result = threadId
          ? await rpc(
              "thread/resume",
              env.CODEX_SOCKET_PATH
                ? { threadId, excludeTurns: true }
                : { threadId, ...overrides, excludeTurns: true },
            )
          : await rpc("thread/start", { ...overrides, ephemeral });
        threadId = result.thread.id;
        const input = `${VISION_GUIDANCE}\n현재 장기비전: ${JSON.stringify(vision)}\n직접 수정 권한: ${allowWrite}\n${hadThread ? "이번 입력: " : "가져온 대화와 이번 입력: "}${JSON.stringify(hadThread ? messages.at(-1)?.content : messages.map(({ role, content }) => ({ role, content })))}`;
        let timer;
        const completed = new Promise((resolve, reject) => {
          activeTurn = { threadId, text: "", resolve, reject };
          timer = setTimeout(() => {
            if (activeTurn?.threadId === threadId) {
              const active = activeTurn;
              activeTurn = null;
              if (env.CODEX_SOCKET_PATH && active.turnId)
                void rpc("turn/interrupt", {
                  threadId,
                  turnId: active.turnId,
                }).catch(() => {});
              else child?.kill();
            }
            reject(
              Object.assign(new Error("Codex 응답 시간이 초과됐어요."), {
                status: 502,
              }),
            );
          }, turnTimeout);
        });
        // Server-side rejection can arrive before turn/start has returned.
        completed.catch(() => {});
        try {
          const started = await rpc("turn/start", {
            threadId,
            input: [{ type: "text", text: input }],
            cwd: root,
            approvalPolicy: "untrusted",
            sandboxPolicy: { type: "readOnly" },
            outputSchema: VISION_REPLY_SCHEMA,
          });
          if (activeTurn?.threadId === threadId)
            activeTurn.turnId = started.turn?.id;
          const text = await completed;
          let answer;
          try {
            answer = replySchema.parse(JSON.parse(text));
          } catch {
            failAI(
              502,
              "Codex 응답 형식을 확인하지 못했어요. 비전은 변경하지 않았어요.",
            );
          }
          return { ...answer, threadId };
        } finally {
          clearTimeout(timer);
          if (activeTurn?.threadId === threadId) {
            const unfinished = activeTurn;
            activeTurn = null;
            if (env.CODEX_SOCKET_PATH && unfinished.turnId)
              void rpc("turn/interrupt", {
                threadId,
                turnId: unfinished.turnId,
              }).catch(() => {});
            else child?.kill();
          }
        }
      } finally {
        turnBusy = false;
      }
    },
    close() {
      child?.kill();
    },
  };
}
