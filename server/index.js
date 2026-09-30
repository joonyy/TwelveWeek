import { createPool } from "./db.js";
import { createApp } from "./app.js";
import { migrate } from "./migrate.js";
const pool = createPool();
await migrate(pool); // A failed migration prevents a misleading healthy deployment.
const server = createApp({ pool }).listen(
  Number(process.env.PORT || 4110),
  "0.0.0.0",
  () => console.log(`Twelve API listening on ${process.env.PORT || 4110}`),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () =>
    server.close(async () => {
      await pool.end();
      process.exit(0);
    }),
  );
