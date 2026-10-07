import express from "express";
import {
  randomUUID,
  randomBytes,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { transaction } from "./db.js";
import { failAI } from "./vision-service.js";
const hash = (v) => createHash("sha256").update(v).digest("hex");
const opaque = () => randomBytes(32).toString("base64url");
const scopes = ["vision:read", "vision:write"];
export function mountVisionMCP(
  app,
  { pool, now, service, webOrigin, rateLimits, env = process.env },
) {
  const base = (env.API_PUBLIC_URL || "http://127.0.0.1:4110").replace(
    /\/$/,
    "",
  );
  const resource = `${base}/mcp`;
  const web = (env.WEB_PUBLIC_URL || webOrigin.split(",")[0]).replace(
    /\/$/,
    "",
  );
  for (const path of ["/oauth", "/api/ai", "/mcp"])
    app.use(path, (req, res, next) => {
      res.set("Cache-Control", "no-store");
      next();
    });
  if (rateLimits)
    app.use(
      "/oauth",
      rateLimit({
        windowMs: 60000,
        limit: 40,
        standardHeaders: "draft-8",
        legacyHeaders: false,
      }),
    );
  const metadata = {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: scopes,
  };
  app.get("/.well-known/oauth-authorization-server", (req, res) =>
    res.json(metadata),
  );
  const protectedMetadata = {
    resource,
    authorization_servers: [base],
    scopes_supported: scopes,
    resource_name: "TwelveWeek 장기비전",
  };
  app.get(
    [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
    ],
    (req, res) => res.json(protectedMetadata),
  );
  app.post("/oauth/register", async (req, res) => {
    const input = z
      .object({
        client_name: z.string().max(100).default("외부 AI"),
        redirect_uris: z.array(z.url()).min(1).max(10),
      })
      .parse(req.body);
    for (const uri of input.redirect_uris) {
      const url = new URL(uri);
      if (
        url.hash ||
        url.username ||
        url.password ||
        !(
          url.protocol === "https:" ||
          (url.protocol === "http:" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
        )
      )
        failAI(400, "HTTPS 또는 로컬 콜백 주소만 등록할 수 있어요.");
    }
    const id = randomUUID();
    await pool.query(
      "INSERT INTO ai_oauth_clients(id,name,redirect_uris) VALUES($1,$2,$3)",
      [id, input.client_name, JSON.stringify(input.redirect_uris)],
    );
    res.status(201).json({
      client_id: id,
      client_name: input.client_name,
      redirect_uris: input.redirect_uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
  });
  const authorizeInput = z.object({
    client_id: z.string().max(200),
    redirect_uri: z.url(),
    response_type: z.literal("code"),
    code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    code_challenge_method: z.literal("S256"),
    scope: z.string().max(100).default("vision:read"),
    state: z.string().max(2000).default(""),
    resource: z.literal(resource),
  });
  const validate = async (raw) => {
    const input = authorizeInput.parse(raw);
    const client = (
      await pool.query("SELECT * FROM ai_oauth_clients WHERE id=$1", [
        input.client_id,
      ])
    ).rows[0];
    if (!client || !client.redirect_uris.includes(input.redirect_uri))
      failAI(400, "등록된 AI 연결 요청이 아니에요.");
    const requested = input.scope.split(" ").filter(Boolean);
    if (
      !requested.includes("vision:read") ||
      requested.some((s) => !scopes.includes(s))
    )
      failAI(400, "장기비전 읽기·수정 권한만 연결할 수 있어요.");
    return { input, client };
  };
  app.get("/oauth/authorize", async (req, res) => {
    const { input } = await validate(req.query);
    const url = new URL(web);
    url.searchParams.set(
      "ai_authorize",
      Buffer.from(JSON.stringify(input)).toString("base64url"),
    );
    res.redirect(url.toString());
  });
  app.post("/api/ai/oauth/preview", async (req, res) => {
    const { client, input } = await validate(req.body);
    res.json({
      name: client.name,
      scopes: input.scope.split(" "),
      redirectOrigin: new URL(input.redirect_uri).origin,
    });
  });
  app.post("/api/ai/oauth/approve", async (req, res) => {
    const { cycleId, ...raw } = req.body;
    const { input } = await validate(raw);
    const cycle = await service.owned(
      pool,
      req.profile.id,
      z.uuid().parse(cycleId),
    );
    if (input.scope.includes("vision:write") && cycle.status === "complete")
      failAI(409, "마친 주기에는 수정 권한을 연결할 수 없어요.");
    const code = opaque();
    await pool.query("DELETE FROM ai_oauth_codes WHERE expires_at<$1", [now()]);
    await pool.query(
      "INSERT INTO ai_oauth_codes(code_hash,client_id,profile_id,cycle_id,redirect_uri,challenge,scope,resource,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        hash(code),
        input.client_id,
        req.profile.id,
        cycleId,
        input.redirect_uri,
        input.code_challenge,
        input.scope,
        resource,
        new Date(+now() + 300000),
      ],
    );
    const url = new URL(input.redirect_uri);
    url.searchParams.set("code", code);
    url.searchParams.set("state", input.state);
    url.searchParams.set("iss", base);
    res.json({ redirect: url.toString() });
  });
  app.post(
    "/oauth/token",
    express.urlencoded({ extended: false, limit: "16kb" }),
    async (req, res) => {
      try {
        const b = z
          .object({
            grant_type: z.enum(["authorization_code", "refresh_token"]),
            client_id: z.string().max(200),
            resource: z.literal(resource),
            code: z.string().max(200).optional(),
            code_verifier: z
              .string()
              .regex(/^[A-Za-z0-9._~-]{43,128}$/)
              .optional(),
            redirect_uri: z.url().optional(),
            refresh_token: z.string().max(200).optional(),
          })
          .parse(req.body);
        const tokens = await transaction(pool, async (db) => {
          let binding;
          if (b.grant_type === "authorization_code") {
            binding = (
              await db.query(
                "SELECT * FROM ai_oauth_codes WHERE code_hash=$1 FOR UPDATE",
                [hash(b.code || "")],
              )
            ).rows[0];
            const actual = createHash("sha256")
              .update(b.code_verifier || "")
              .digest("base64url");
            if (
              !binding ||
              binding.client_id !== b.client_id ||
              binding.resource !== resource ||
              binding.redirect_uri !== b.redirect_uri ||
              new Date(binding.expires_at) <= now() ||
              actual.length !== binding.challenge.length ||
              !timingSafeEqual(
                Buffer.from(actual),
                Buffer.from(binding.challenge),
              )
            )
              failAI(400, "invalid_grant");
            await db.query("DELETE FROM ai_oauth_codes WHERE code_hash=$1", [
              binding.code_hash,
            ]);
          } else {
            binding = (
              await db.query(
                "SELECT * FROM ai_oauth_tokens WHERE refresh_hash=$1 FOR UPDATE",
                [hash(b.refresh_token || "")],
              )
            ).rows[0];
            if (
              !binding ||
              binding.client_id !== b.client_id ||
              binding.resource !== resource ||
              binding.revoked_at ||
              new Date(binding.refresh_expires_at) <= now()
            )
              failAI(400, "invalid_grant");
            await db.query(
              "UPDATE ai_oauth_tokens SET revoked_at=$1 WHERE token_hash=$2",
              [now(), binding.token_hash],
            );
          }
          const access = opaque(),
            refresh = opaque();
          await db.query(
            "INSERT INTO ai_oauth_tokens(token_hash,refresh_hash,profile_id,cycle_id,client_id,scope,resource,expires_at,refresh_expires_at,grant_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
            [
              hash(access),
              hash(refresh),
              binding.profile_id,
              binding.cycle_id,
              binding.client_id,
              binding.scope,
              resource,
              new Date(+now() + 3600000),
              new Date(+now() + 30 * 86400000),
              binding.grant_id || randomUUID(),
            ],
          );
          return {
            access_token: access,
            token_type: "Bearer",
            expires_in: 3600,
            refresh_token: refresh,
            scope: binding.scope,
          };
        });
        res.json(tokens);
      } catch (e) {
        res.status(400).json({
          error:
            e.message === "invalid_grant" ? "invalid_grant" : "invalid_request",
        });
      }
    },
  );
  app.get("/api/ai/mcp", async (req, res) => {
    const connections = (
      await pool.query(
        "SELECT t.grant_id AS id,t.cycle_id,c.title,cl.name,t.scope,t.created_at FROM ai_oauth_tokens t JOIN ai_oauth_clients cl ON cl.id=t.client_id JOIN cycles c ON c.id=t.cycle_id WHERE t.profile_id=$1 AND t.revoked_at IS NULL AND t.refresh_expires_at>$2 ORDER BY t.created_at DESC",
        [req.profile.id, now()],
      )
    ).rows;
    res.json({ url: resource, connections });
  });
  app.delete("/api/ai/mcp/:connectionId", async (req, res) => {
    await pool.query(
      "UPDATE ai_oauth_tokens SET revoked_at=$1 WHERE grant_id=$2 AND profile_id=$3",
      [now(), z.uuid().parse(req.params.connectionId), req.profile.id],
    );
    res.status(204).end();
  });
  app.post("/mcp", async (req, res) => {
    const origin = req.headers.origin;
    if (
      origin &&
      ![
        ...webOrigin.split(",").map((v) => v.trim()),
        new URL(base).origin,
        "https://chatgpt.com",
        "https://claude.ai",
      ].includes(origin)
    )
      return res.status(403).json({ error: "origin_not_allowed" });
    const token = req.headers.authorization?.match(
      /^Bearer ([A-Za-z0-9_-]{43})$/,
    )?.[1];
    const auth =
      token &&
      (
        await pool.query(
          "SELECT * FROM ai_oauth_tokens WHERE token_hash=$1 AND expires_at>$2 AND revoked_at IS NULL AND resource=$3",
          [hash(token), now(), resource],
        )
      ).rows[0];
    if (!auth)
      return res
        .status(401)
        .set(
          "WWW-Authenticate",
          `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
        )
        .json({ error: "unauthorized" });
    const server = new McpServer(
      { name: "TwelveWeek Vision", version: "1.0.0" },
      {
        instructions:
          "장기비전만 지원한다. 먼저 read_long_vision으로 현재 비전, 지침, version, 수정 허용 여부를 읽는다. 직접 수정은 사용자 요청과 앱의 수정 권한이 모두 있을 때만 한다. 부분 수정 도구로 기간/목표/점수는 수정할 수 없다.",
      },
    );
    const result = (output) => ({
      content: [{ type: "text", text: JSON.stringify(output) }],
      structuredContent: output,
    });
    const execute = (fn) => async (input) => {
      try {
        // Revocation/expiry is checked again at the point of execution.
        const valid = (
          await pool.query(
            "SELECT 1 FROM ai_oauth_tokens WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>$2",
            [auth.token_hash, now()],
          )
        ).rowCount;
        if (!valid) failAI(403, "AI 연결 권한이 철회됐어요.");
        return result(await fn(input));
      } catch (e) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: e.status ? e.message : "입력과 연결 상태를 확인해주세요.",
            },
          ],
        };
      }
    };
    server.registerTool(
      "read_long_vision",
      {
        title: "장기비전 읽기",
        description:
          "사용자가 연결한 주기의 장기비전과 작성 지침, 최신 version, 수정 권한을 읽는다.",
        inputSchema: {},
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      execute(() => service.context(auth.profile_id, auth.cycle_id)),
    );
    if (auth.scope.split(" ").includes("vision:write"))
      server.registerTool(
        "update_long_vision",
        {
          title: "장기비전 수정",
          description:
            "사용자가 요청하고 TwelveWeek에서 수정 허용한 장기비전 전체를 저장한다. read_long_vision에서 받은 version을 전달한다. 다른 영역은 변경하지 않는다.",
          inputSchema: {
            version: z.number().int().min(0),
            vision: z.string().max(6000),
          },
          annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            openWorldHint: false,
          },
        },
        execute(async (input) => {
          const { cycle, edit } = await service.apply({
            ...input,
            profileId: auth.profile_id,
            cycleId: auth.cycle_id,
            actor: "mcp",
          });
          return {
            cycleId: cycle.id,
            version: cycle.version,
            longVision: cycle.plan.longVision,
            editId: edit?.id || null,
          };
        }),
      );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  app.get("/mcp", (req, res) => res.status(405).set("Allow", "POST").end());
  app.delete("/mcp", (req, res) => res.status(405).set("Allow", "POST").end());
}
