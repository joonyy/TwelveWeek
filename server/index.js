import { createPool } from "./db.js";
import { createApp } from "./app.js";
import { migrate } from "./migrate.js";
import { createCodexBridge } from "./codex-bridge.js";
import { initializeDatabase } from "./database-startup.js";
import { databaseErrorCode } from "./database-errors.js";
import { createRuntimeDiagnostics } from "./runtime-diagnostics.js";
const pool = createPool();
const diagnostics = createRuntimeDiagnostics({ pool });
diagnostics.record("process_started", {
  nodeVersion: process.version,
  ...(/^[a-f0-9]{40}$/.test(process.env.RENDER_GIT_COMMIT || "")
    ? { commit: process.env.RENDER_GIT_COMMIT }
    : {}),
});
process.on("exit", (exitCode) =>
  diagnostics.record("process_exit", { exitCode }),
);
process.on("uncaughtExceptionMonitor", (error, origin) => {
  diagnostics.record("process_fatal", {
    origin,
    code: databaseErrorCode(error),
    errorType: [
      "Error",
      "TypeError",
      "RangeError",
      "SyntaxError",
      "ReferenceError",
      "AggregateError",
    ].includes(error?.name)
      ? error.name
      : "Error",
  });
});
const codex = createCodexBridge();
let ready = false,
  stopping = false;
const startup = new AbortController();
const server = createApp({
  pool,
  codex,
  diagnostics,
  isReady: () => ready,
}).listen(Number(process.env.PORT || 4110), "0.0.0.0", () =>
  console.log(`Twelve API listening on ${process.env.PORT || 4110}`),
);
async function stop(code, reason) {
  if (stopping) return;
  stopping = true;
  diagnostics.record("process_stopping", { reason, exitCode: code });
  diagnostics.close();
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
  process.on(signal, () => void stop(0, signal));

initializeDatabase({ migrate: () => migrate(pool), signal: startup.signal })
  .then(() => {
    if (!stopping) {
      ready = true;
      diagnostics.record("database_ready");
      console.log("Twelve API database ready");
    }
  })
  .catch((error) => {
    if (stopping) return;
    console.error("[database startup failed]", databaseErrorCode(error));
    void stop(1, "database_startup_failed");
  });
