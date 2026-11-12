import pg from "pg";
import { readFileSync } from "node:fs";
import { databaseErrorCode } from "./database-errors.js";
pg.types.setTypeParser(1082, (value) => value);
export function createPool(url = process.env.DATABASE_URL) {
  if (!url)
    throw new Error("DATABASE_URL을 설정해주세요. .env.example을 참고하세요.");
  const parsed = new URL(url);
  // Avoid connection-string sslmode overriding certificate verification.
  for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert"])
    parsed.searchParams.delete(key);
  const ssl = process.env.DATABASE_SSL === "true";
  if (process.env.NODE_ENV === "production" && !ssl)
    throw new Error("배포 환경에서는 DATABASE_SSL=true가 필요합니다.");
  const ca = process.env.DATABASE_CA_PATH
    ? readFileSync(process.env.DATABASE_CA_PATH, "utf8")
    : process.env.DATABASE_CA_PEM?.replaceAll("\\n", "\n");
  const pool = new pg.Pool({
    connectionString: parsed.toString(),
    max: 5,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 10000,
    lock_timeout: 5000,
    query_timeout: 15000,
    idle_in_transaction_session_timeout: 30000,
    keepAlive: true,
    application_name: "twelveweek-api",
    ssl: ssl ? { rejectUnauthorized: true, ...(ca ? { ca } : {}) } : false,
  });
  // pg removes a disconnected idle client itself. Without this listener the
  // pool's background error becomes an uncaught exception and exits Node.
  pool.on("error", (error) =>
    console.error("[database idle connection]", databaseErrorCode(error)),
  );
  return pool;
}
export async function transaction(pool, fn) {
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original failure and never return a broken connection.
      discard = true;
    }
    throw error;
  } finally {
    client.release(discard);
  }
}
