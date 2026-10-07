import { randomUUID } from "node:crypto";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { transaction } from "./db.js";
import {
  createAIProvider,
  encryptKey,
  decryptKey,
  replySchema,
} from "./ai-provider.js";
import { createVisionService, failAI } from "./vision-service.js";
import { importConversation } from "../shared/vision-ai.js";

const providerSchema = z.enum(["openai", "anthropic", "codex"]);
const apiProvider = z.enum(["openai", "anthropic"]);
const safeConversation = ({ busy_until, ...row }, now) => ({
  ...row,
  busy: !!busy_until && new Date(busy_until) > now(),
});
export function mountAIRoutes(
  app,
  {
    pool,
    now,
    rateLimits,
    aiProvider = createAIProvider(),
    codex = null,
    env = process.env,
  },
) {
  const service = createVisionService({ pool, now });
  const actor = (req) => req.profile.id;
  const conversation = async (db, req, lock = false) => {
    const c = (
      await db.query(
        `SELECT * FROM ai_conversations WHERE id=$1 AND profile_id=$2 AND cycle_id=$3${lock ? " FOR UPDATE" : ""}`,
        [
          z.uuid().parse(req.params.conversationId),
          actor(req),
          req.params.cycleId,
        ],
      )
    ).rows[0];
    if (!c) failAI(404, "대화를 찾을 수 없어요.");
    return c;
  };
  app.get("/api/ai/config", async (req, res) => {
    const own = (
      await pool.query(
        "SELECT provider,model FROM ai_connections WHERE profile_id=$1",
        [actor(req)],
      )
    ).rows;
    res.json({
      providers: ["openai", "anthropic"].map((provider) => ({
        provider,
        connected:
          own.some((c) => c.provider === provider) ||
          aiProvider.available(provider),
        personal: own.some((c) => c.provider === provider),
        model:
          own.find((c) => c.provider === provider)?.model ||
          aiProvider.model(provider),
      })),
      canSaveKeys: !!env.AI_SECRETS_KEY && env.AI_SECRETS_KEY.length >= 32,
      codex: !!codex?.available(actor(req)),
    });
  });
  app.put("/api/ai/connections/:provider", async (req, res) => {
    const provider = apiProvider.parse(req.params.provider);
    const { key, model } = z
      .object({
        key: z.string().trim().min(10).max(1000),
        model: z.string().trim().min(1).max(120),
      })
      .strict()
      .parse(req.body);
    await pool.query(
      "INSERT INTO ai_connections(profile_id,provider,model,secret_cipher) VALUES($1,$2,$3,$4) ON CONFLICT(profile_id,provider) DO UPDATE SET model=$3,secret_cipher=$4,updated_at=now()",
      [actor(req), provider, model, encryptKey(key, env.AI_SECRETS_KEY)],
    );
    res.json({ provider, model, connected: true });
  });
  app.delete("/api/ai/connections/:provider", async (req, res) => {
    await pool.query(
      "DELETE FROM ai_connections WHERE profile_id=$1 AND provider=$2",
      [actor(req), apiProvider.parse(req.params.provider)],
    );
    res.status(204).end();
  });
  app.get("/api/ai/codex/threads", async (req, res) => {
    if (!codex?.available(actor(req)))
      failAI(503, "로컬 Codex 연결이 설정되지 않았어요.");
    res.json(await codex.list());
  });
  const prefix = "/api/ai/cycles/:cycleId";
  app.get(`${prefix}/context`, async (req, res) =>
    res.json(await service.context(actor(req), req.params.cycleId)),
  );
  app.put(`${prefix}/permission`, async (req, res) =>
    res.json(
      await service.grant(
        actor(req),
        req.params.cycleId,
        z.object({ allowWrite: z.boolean() }).strict().parse(req.body)
          .allowWrite,
      ),
    ),
  );
  app.get(`${prefix}/edits`, async (req, res) =>
    res.json(await service.edits(actor(req), req.params.cycleId)),
  );
  app.post(`${prefix}/edits/:editId/undo`, async (req, res) =>
    res.json(
      await service.undo(
        actor(req),
        req.params.cycleId,
        req.params.editId,
        z
          .object({ version: z.number().int().min(0) })
          .strict()
          .parse(req.body).version,
      ),
    ),
  );
  app.post(`${prefix}/vision`, async (req, res) => {
    const input = z
      .object({
        version: z.number().int().min(0),
        vision: z.string().max(6000),
      })
      .strict()
      .parse(req.body);
    res.json(
      await service.apply({
        ...input,
        profileId: actor(req),
        cycleId: req.params.cycleId,
        actor: "user.accepted",
        requirePermission: false,
      }),
    );
  });
  app.get(`${prefix}/conversations`, async (req, res) => {
    await service.owned(pool, actor(req), req.params.cycleId);
    res.json(
      (
        await pool.query(
          "SELECT id,title,provider,source,source_label,version,updated_at FROM ai_conversations WHERE cycle_id=$1 AND profile_id=$2 ORDER BY updated_at DESC LIMIT 100",
          [req.params.cycleId, actor(req)],
        )
      ).rows,
    );
  });
  app.post(`${prefix}/conversations`, async (req, res) => {
    await service.owned(pool, actor(req), req.params.cycleId);
    const input = z
      .object({
        provider: providerSchema,
        title: z.string().trim().min(1).max(120).default("장기비전 대화"),
        transcript: z.string().max(120000).optional(),
        sourceLabel: z.string().max(80).default(""),
        remoteThreadId: z.string().max(160).optional(),
      })
      .strict()
      .parse(req.body);
    let messages = [],
      source = "native";
    if (input.transcript) {
      try {
        messages = importConversation(input.transcript);
      } catch (e) {
        failAI(400, e.message);
      }
      source = "import";
    }
    if (input.remoteThreadId) {
      if (input.provider !== "codex" || !codex?.available(actor(req)))
        failAI(400, "로컬 Codex 연결을 먼저 설정해주세요.");
      if (input.transcript)
        failAI(400, "대화 가져오기와 Codex resume는 따로 선택해주세요.");
      messages = await codex.read(input.remoteThreadId);
      source = "codex";
    }
    if (input.provider === "codex" && !codex?.available(actor(req)))
      failAI(503, "로컬 Codex 연결이 설정되지 않았어요.");
    const id = randomUUID();
    const c = (
      await pool.query(
        "INSERT INTO ai_conversations(id,profile_id,cycle_id,title,provider,source,source_label,remote_thread_id,messages) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
        [
          id,
          actor(req),
          req.params.cycleId,
          input.title,
          input.provider,
          source,
          input.sourceLabel,
          input.remoteThreadId || null,
          JSON.stringify(
            messages.map((m) => ({ ...m, id: randomUUID(), imported: true })),
          ),
        ],
      )
    ).rows[0];
    res.status(201).json(safeConversation(c, now));
  });
  app.get(`${prefix}/conversations/:conversationId`, async (req, res) =>
    res.json(safeConversation(await conversation(pool, req), now)),
  );
  const turnPath = `${prefix}/conversations/:conversationId/messages`;
  if (rateLimits)
    app.use(
      turnPath,
      rateLimit({
        windowMs: 60000,
        limit: 12,
        standardHeaders: "draft-8",
        legacyHeaders: false,
      }),
    );
  app.post(turnPath, async (req, res) => {
    const input = z
      .object({
        message: z.string().trim().min(1).max(6000),
        requestId: z.uuid(),
        version: z.number().int().min(0),
        cycleVersion: z.number().int().min(0),
      })
      .strict()
      .parse(req.body);
    const reserved = await transaction(pool, async (db) => {
      const c = await conversation(db, req, true);
      if (
        c.messages.some(
          (m) => m.requestId === input.requestId && m.role === "assistant",
        )
      )
        return { done: true, c };
      if (c.busy_until && new Date(c.busy_until) > now())
        failAI(409, "이 대화의 AI가 응답 중이에요. 잠시 후 다시 열어주세요.");
      if (c.version !== input.version)
        failAI(409, "대화가 다른 화면에서 변경됐어요. 다시 불러와주세요.");
      const cycle = await service.owned(db, actor(req), req.params.cycleId);
      if (cycle.version !== input.cycleVersion)
        failAI(
          409,
          "비전이나 계획이 변경됐어요. 최신 내용을 먼저 불러와주세요.",
        );
      const previous = c.messages.find(
        (m) => m.requestId === input.requestId && m.role === "user",
      );
      if (
        previous &&
        (previous !== c.messages.at(-1) || previous.content !== input.message)
      )
        failAI(409, "마지막에 저장된 질문만 다시 보낼 수 있어요.");
      if (
        c.messages.length + (previous ? 1 : 2) > 300 ||
        c.messages.reduce((n, m) => n + m.content.length, 0) +
          (previous ? 0 : input.message.length) >
          180000
      )
        failAI(
          400,
          "대화가 길어졌어요. 필요한 내용을 요약해서 새 대화로 이어가주세요.",
        );
      const keyRow = (
        await db.query(
          "SELECT * FROM ai_connections WHERE profile_id=$1 AND provider=$2",
          [actor(req), c.provider],
        )
      ).rows[0];
      if (
        c.provider !== "codex" &&
        !keyRow &&
        !aiProvider.available(c.provider)
      )
        failAI(503, "사용할 AI의 API 키를 연결해주세요.");
      if (c.provider === "codex" && !codex?.available(actor(req)))
        failAI(503, "로컬 Codex 연결이 설정되지 않았어요.");
      const messages = previous
        ? c.messages
        : [
            ...c.messages,
            {
              id: randomUUID(),
              role: "user",
              content: input.message,
              requestId: input.requestId,
              createdAt: now().toISOString(),
            },
          ];
      const changed = (
        await db.query(
          "UPDATE ai_conversations SET messages=$1,version=version+1,busy_until=$2,updated_at=$3 WHERE id=$4 RETURNING *",
          [JSON.stringify(messages), new Date(+now() + 180000), now(), c.id],
        )
      ).rows[0];
      return {
        c: changed,
        cycle,
        allowWrite: await service.permission(db, cycle.id),
        keyRow,
      };
    });
    if (reserved.done)
      return res.json({
        conversation: safeConversation(reserved.c, now),
        cycle: await service.owned(pool, actor(req), req.params.cycleId),
      });
    let answer, remoteThreadId;
    try {
      const args = {
        provider: reserved.c.provider,
        messages: reserved.c.messages,
        vision: reserved.cycle.plan.longVision,
        allowWrite: reserved.allowWrite,
        model: reserved.keyRow?.model,
        key: reserved.keyRow
          ? decryptKey(reserved.keyRow.secret_cipher, env.AI_SECRETS_KEY)
          : undefined,
      };
      const generated =
        reserved.c.provider === "codex"
          ? await codex.generate({
              ...args,
              threadId: reserved.c.remote_thread_id,
              conversationId: reserved.c.id,
            })
          : await aiProvider.generate(args);
      remoteThreadId = generated.threadId;
      answer = replySchema.parse({
        message: generated.message,
        vision: generated.vision,
      });
    } catch (e) {
      await pool.query(
        "UPDATE ai_conversations SET busy_until=NULL WHERE id=$1 AND version=$2",
        [reserved.c.id, reserved.c.version],
      );
      if (e.status) throw e;
      failAI(502, "AI 응답을 받지 못했어요. 보낸 메시지는 저장됐어요.");
    }
    const result = await transaction(pool, async (db) => {
      const c = await conversation(db, req, true);
      if (c.version !== reserved.c.version)
        failAI(409, "다른 응답이 먼저 저장됐어요. 대화를 다시 열어주세요.");
      let cycle = await service.owned(db, actor(req), req.params.cycleId, true),
        applied = false,
        warning = "";
      if (answer.vision !== null && reserved.allowWrite) {
        if (!(await service.permission(db, cycle.id)))
          warning = "수정 권한이 철회되어 제안으로 남겼어요.";
        else if (
          cycle.version !== input.cycleVersion ||
          cycle.status === "complete"
        )
          warning =
            "계획이 변경되어 제안으로 남겼어요. 내용을 확인한 뒤 반영해주세요.";
        else {
          const result = await service.write(db, {
            profileId: actor(req),
            cycleId: cycle.id,
            version: cycle.version,
            vision: answer.vision,
            actor: c.provider,
            conversationId: c.id,
          });
          cycle = result.cycle;
          applied = true;
        }
      }
      const messages = [
        ...c.messages,
        {
          id: randomUUID(),
          role: "assistant",
          content: answer.message,
          proposedVision: answer.vision,
          applied,
          warning,
          requestId: input.requestId,
          createdAt: now().toISOString(),
        },
      ];
      const updated = (
        await db.query(
          "UPDATE ai_conversations SET messages=$1,version=version+1,busy_until=NULL,updated_at=$2,remote_thread_id=COALESCE($3,remote_thread_id) WHERE id=$4 RETURNING *",
          [JSON.stringify(messages), now(), remoteThreadId || null, c.id],
        )
      ).rows[0];
      return { conversation: safeConversation(updated, now), cycle };
    });
    res.json(result);
  });
  return service;
}
