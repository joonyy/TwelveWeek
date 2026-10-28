import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createPool, transaction } from "./db.js";
import { hashPassword } from "./passwords.js";
export async function migrate(
  pool,
  { initialProfilePassword = process.env.INITIAL_PROFILE_PASSWORD } = {},
) {
  await transaction(pool, async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(12052026)");
    await db.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const name of [
      "001_initial",
      "002_reflection",
      "003_cycle_length",
      "004_vision_ai",
      "005_ai_token_family",
      "006_calendar",
      "007_profile_password",
    ]) {
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
        if (name === "007_profile_password") {
          // User-approved one-time initial password for pre-existing profiles.
          // Running migrate again never resets a changed password.
          const profiles = await db.query("SELECT id FROM profiles FOR UPDATE");
          if (
            profiles.rowCount &&
            (typeof initialProfilePassword !== "string" ||
              initialProfilePassword.length < 4 ||
              initialProfilePassword.length > 128)
          )
            throw new Error(
              "Set INITIAL_PROFILE_PASSWORD when upgrading existing profiles",
            );
          for (const profile of profiles.rows)
            await db.query("UPDATE profiles SET password_hash=$1 WHERE id=$2", [
              await hashPassword(initialProfilePassword),
              profile.id,
            ]);
          await db.query(
            "ALTER TABLE profiles ALTER COLUMN password_hash SET NOT NULL",
          );
        }
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
