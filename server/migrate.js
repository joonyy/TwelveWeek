import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createPool, transaction } from "./db.js";
export async function migrate(pool) {
  await transaction(pool, async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(12052026)");
    await db.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const name of ["001_initial", "002_reflection"]) {
      const existing = await db.query(
        "SELECT 1 FROM schema_migrations WHERE name=$1",
        [name],
      );
      if (!existing.rowCount) {
        const sql = await readFile(
          new URL(`./${name}.sql`, import.meta.url),
          "utf8",
        );
        await db.query(sql);
        await db.query("INSERT INTO schema_migrations(name) VALUES($1)", [
          name,
        ]);
      }
    }
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const pool = createPool();
  try {
    await migrate(pool);
    console.log("Database migration complete.");
  } finally {
    await pool.end();
  }
}
