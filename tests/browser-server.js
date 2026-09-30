import { createPool } from "../server/db.js";
import { migrate } from "../server/migrate.js";
import { createApp } from "../server/app.js";
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("Browser tests require a dedicated _test database");
const pool = createPool(url);
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
}).listen(4111, "127.0.0.1");
