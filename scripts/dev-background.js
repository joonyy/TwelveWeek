import { spawn } from "node:child_process";
import { mkdirSync, openSync, closeSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const endpoints = [
  `http://127.0.0.1:${process.env.PORT || 4110}/api/health`,
  `http://127.0.0.1:${process.env.TWELVE_WEB_PORT || 5178}/`,
];
const running = await Promise.all(
  endpoints.map(async (endpoint) => {
    try {
      return (await fetch(endpoint, { signal: AbortSignal.timeout(1500) })).ok;
    } catch {
      return false;
    }
  }),
);
if (running.some(Boolean)) {
  console.log(
    running.every(Boolean)
      ? "TwelveWeek가 이미 실행 중이에요."
      : "일부 서버가 실행 중이에요. 기존 실행을 확인해주세요.",
  );
  process.exit(running.every(Boolean) ? 0 : 1);
}
mkdirSync(resolve(root, ".logs"), { recursive: true });
const output = openSync(resolve(root, ".logs/dev.log"), "a");
const child = spawn(
  process.execPath,
  [process.env.npm_execpath, "run", "dev"],
  {
    cwd: root,
    detached: true,
    stdio: ["ignore", output, output],
    env: process.env,
  },
);
child.unref();
closeSync(output);
writeFileSync(resolve(root, ".logs/dev.pid"), String(child.pid) + "\n");
console.log(
  `TwelveWeek를 독립 실행했어요. PID ${child.pid}, 로그: .logs/dev.log`,
);
