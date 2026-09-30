import pg from "pg";
import { readFileSync } from "node:fs";
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
  return new pg.Pool({
    connectionString: parsed.toString(),
    max: 5,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    ssl: ssl ? { rejectUnauthorized: true, ...(ca ? { ca } : {}) } : false,
  });
}
export async function transaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
