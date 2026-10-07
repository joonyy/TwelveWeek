import { createPool } from "./db.js";
import { createApp } from "./app.js";
import { migrate } from "./migrate.js";
import { createCodexBridge } from "./codex-bridge.js";
const pool = createPool();
const codex = createCodexBridge();
await migrate(pool); // A failed migration prevents a misleading healthy deployment.
const server = createApp({ pool, codex }).listen(
  Number(process.env.PORT || 4110),
  "0.0.0.0",
  () => console.log(`Twelve API listening on ${process.env.PORT || 4110}`),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () =>
    server.close(async () => {
      codex.close();
      await pool.end();
      process.exit(0);
    }),
  );
