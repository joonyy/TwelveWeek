import { createPool } from "./db.js";
import { createApp } from "./app.js";
import { migrate } from "./migrate.js";
import { createCodexBridge } from "./codex-bridge.js";
import { initializeDatabase } from "./database-startup.js";
import { databaseErrorCode } from "./database-errors.js";
const pool = createPool();
const codex = createCodexBridge();
let ready = false,
  stopping = false;
const startup = new AbortController();
const server = createApp({ pool, codex, isReady: () => ready }).listen(
  Number(process.env.PORT || 4110),
  "0.0.0.0",
  () => console.log(`Twelve API listening on ${process.env.PORT || 4110}`),
);
async function stop(code) {
  if (stopping) return;
  stopping = true;
  ready = false;
  startup.abort();
  const force = setTimeout(() => process.exit(code), 10000);
  force.unref();
  server.close(async () => {
    codex.close();
    await pool.end();
    clearTimeout(force);
    process.exit(code);
  });
}
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => void stop(0));

initializeDatabase({ migrate: () => migrate(pool), signal: startup.signal })
  .then(() => {
    if (!stopping) {
      ready = true;
      console.log("Twelve API database ready");
    }
  })
  .catch((error) => {
    if (stopping) return;
    console.error("[database startup failed]", databaseErrorCode(error));
    void stop(1);
  });
