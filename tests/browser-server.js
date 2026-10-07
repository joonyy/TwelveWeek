import { createPool } from "../server/db.js";
import { migrate } from "../server/migrate.js";
import { createApp } from "../server/app.js";
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("Browser tests require a dedicated _test database");
const pool = createPool(url);
const failedTurns = new Set();
await migrate(pool);
await pool.query(
  "TRUNCATE changes,weeks,cycles,sessions,profiles RESTART IDENTITY CASCADE",
);
// Fixed clock is isolated to the test server, never supported by production API.
createApp({
  pool,
  now: () => new Date("2026-10-07T12:00:00+09:00"),
  rateLimits: false,
  webOrigin: "http://127.0.0.1:5179",
  aiEnv: {
    AI_SECRETS_KEY: "browser-test-only-secret-32-characters",
    API_PUBLIC_URL: "http://127.0.0.1:4111",
    WEB_PUBLIC_URL: "http://127.0.0.1:5179",
  },
  aiProvider: {
    available: () => true,
    model: () => "browser-test-model",
    async generate({ messages }) {
      const last = messages.at(-1);
      if (
        last.content === "연결 오류 재시도 시험" &&
        !failedTurns.has(last.requestId)
      ) {
        failedTurns.add(last.requestId);
        throw Object.assign(new Error("AI 연결 실패 시험"), { status: 502 });
      }
      return {
        message: "가격 때문에 포기하고 싶지 않은 선택에는 어떤 것들이 있나요?",
        vision: messages.at(-1).content.includes("반영")
          ? "소중한 사람과의 경험을 가격 때문에 포기하지 않는 삶"
          : null,
      };
    },
  },
}).listen(4111, "127.0.0.1");
