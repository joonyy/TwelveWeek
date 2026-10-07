import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { z } from "zod";
import { VISION_GUIDANCE, VISION_REPLY_SCHEMA } from "../shared/vision-ai.js";

export const replySchema = z
  .object({
    message: z.string().trim().min(1).max(12000),
    vision: z.string().max(6000).nullable(),
  })
  .strict();
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const keyFor = (secret) => {
  if (!secret || secret.length < 32)
    fail(
      503,
      "AI 키 저장을 위한 서버 설정이 필요해요. AI_SECRETS_KEY를 설정해주세요.",
    );
  return createHash("sha256").update(secret).digest();
};
export function encryptKey(value, secret) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", keyFor(secret), iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body]
    .map((b) => b.toString("base64url"))
    .join(".");
}
export function decryptKey(value, secret) {
  const [iv, tag, body] = value
    .split(".")
    .map((s) => Buffer.from(s, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", keyFor(secret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString(
    "utf8",
  );
}
export function createAIProvider({
  fetchImpl = fetch,
  env = process.env,
} = {}) {
  return {
    available(provider) {
      return !!env[
        provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"
      ];
    },
    model(provider) {
      return (
        env[provider === "openai" ? "OPENAI_MODEL" : "ANTHROPIC_MODEL"] || ""
      );
    },
    async generate({ provider, model, key, messages, vision, allowWrite }) {
      key ||=
        env[provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"];
      model ||= this.model(provider);
      if (!key)
        fail(
          503,
          "이 AI의 API 키를 연결해주세요. 기존 채팅 구독 로그인과 API 키는 별개예요.",
        );
      if (!model) fail(400, "연결 설정에서 사용할 모델 ID를 입력해주세요.");
      const system = `${VISION_GUIDANCE}\n현재 저장된 장기비전: ${JSON.stringify(vision)}\n직접 수정 권한: ${allowWrite ? "허용" : "없음. 수정안은 제안으로만 남긴다"}`;
      const definition = {
        name: "vision_reply",
        description: "장기비전 대화 응답과 선택적인 수정안을 반환한다",
        parameters: VISION_REPLY_SCHEMA,
      };
      let url, body, headers;
      if (provider === "openai") {
        url = "https://api.openai.com/v1/responses";
        headers = { Authorization: `Bearer ${key}` };
        body = {
          model,
          store: false,
          max_output_tokens: 4096,
          instructions: system,
          input: messages.map(({ role, content }) => ({ role, content })),
          tools: [{ type: "function", ...definition, strict: true }],
          tool_choice: { type: "function", name: "vision_reply" },
        };
      } else {
        url = "https://api.anthropic.com/v1/messages";
        headers = { "x-api-key": key, "anthropic-version": "2023-06-01" };
        body = {
          model,
          max_tokens: 3000,
          system,
          messages: messages.map(({ role, content }) => ({ role, content })),
          tools: [
            {
              name: definition.name,
              description: definition.description,
              input_schema: VISION_REPLY_SCHEMA,
            },
          ],
          tool_choice: { type: "tool", name: "vision_reply" },
        };
      }
      let response;
      try {
        response = await fetchImpl(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(90000),
        });
      } catch {
        fail(
          502,
          "AI 응답을 받지 못했어요. 대화는 저장됐으니 다시 시도할 수 있어요.",
        );
      }
      if (!response.ok)
        fail(
          response.status === 401 ? 422 : 502,
          response.status === 401
            ? "AI API 키를 확인해주세요."
            : response.status === 429
              ? "AI 사용 한도에 도달했어요. 잠시 후 다시 시도해주세요."
              : "AI 제공자가 요청을 처리하지 못했어요. 모델 ID와 연결 설정을 확인해주세요.",
        );
      const data = await response.json();
      let reply;
      try {
        reply =
          provider === "openai"
            ? JSON.parse(
                data.output.find(
                  (o) =>
                    o.type === "function_call" && o.name === "vision_reply",
                ).arguments,
              )
            : data.content.find(
                (o) => o.type === "tool_use" && o.name === "vision_reply",
              ).input;
        return replySchema.parse(reply);
      } catch {
        fail(
          502,
          "AI 응답 형식을 확인하지 못했어요. 비전은 변경하지 않았어요.",
        );
      }
    },
  };
}
