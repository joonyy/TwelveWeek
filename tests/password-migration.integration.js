import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { createPool } from "../server/db.js";
import { migrate } from "../server/migrate.js";
import { hashPassword, verifyPassword } from "../server/passwords.js";

test("legacy profiles get 1234 once with distinct salts while IDs, records and sessions survive", async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !new URL(url).pathname.endsWith("_test"))
    throw new Error("Use a dedicated _test database");
  const schema = `auth_migration_${randomUUID().replaceAll("-", "")}`;
  const admin = createPool(url);
  await admin.query(`CREATE SCHEMA ${schema}`);
  const scopedUrl = new URL(url);
  scopedUrl.searchParams.set("options", `-c search_path=${schema}`);
  const pool = createPool(scopedUrl.toString());
  try {
    await migrate(pool);
    // Recreate the pre-password schema in a disposable, isolated test schema.
    await pool.query("ALTER TABLE profiles DROP COLUMN password_hash");
    await pool.query(
      "DELETE FROM schema_migrations WHERE name='007_profile_password'",
    );
    const ids = [randomUUID(), randomUUID()];
    for (const [i, id] of ids.entries())
      await pool.query(
        "INSERT INTO profiles(id,name,normalized_name) VALUES($1,$2,$2)",
        [id, `legacy-${i}`],
      );
    const cycleId = randomUUID();
    await pool.query(
      "INSERT INTO cycles(id,profile_id,title,start_date,plan) VALUES($1,$2,'보존할 계획','2026-10-19',$3)",
      [
        cycleId,
        ids[0],
        JSON.stringify({
          longVision: "그대로 보존",
          goals: [{ title: "기존 목표" }],
        }),
      ],
    );
    await pool.query(
      "INSERT INTO weeks(cycle_id,number,state) VALUES($1,1,$2)",
      [
        cycleId,
        JSON.stringify({
          occurrences: [{ id: "retained", completed: true }],
          review: "기존 평가",
        }),
      ],
    );
    await pool.query(
      "INSERT INTO sessions(token_hash,profile_id,expires_at) VALUES($1,$2,now()+interval '1 year')",
      [createHash("sha256").update("legacy-token").digest("hex"), ids[0]],
    );
    const before = (
      await pool.query(
        "SELECT c.id,c.profile_id,c.plan,w.state FROM cycles c JOIN weeks w ON w.cycle_id=c.id",
      )
    ).rows;
    await assert.rejects(migrate(pool), /INITIAL_PROFILE_PASSWORD/);
    await migrate(pool, { initialProfilePassword: "1234" });
    const profiles = (
      await pool.query("SELECT id,password_hash FROM profiles ORDER BY name")
    ).rows;
    assert.deepEqual(
      profiles.map((p) => p.id),
      ids,
    );
    assert.notEqual(profiles[0].password_hash, profiles[1].password_hash);
    for (const p of profiles)
      assert.equal(await verifyPassword("1234", p.password_hash), true);
    assert.deepEqual(
      (
        await pool.query(
          "SELECT c.id,c.profile_id,c.plan,w.state FROM cycles c JOIN weeks w ON w.cycle_id=c.id",
        )
      ).rows,
      before,
    );
    assert.equal(
      Number((await pool.query("SELECT count(*) n FROM sessions")).rows[0].n),
      1,
    );
    const changed = await hashPassword("changed-password");
    await pool.query("UPDATE profiles SET password_hash=$1 WHERE id=$2", [
      changed,
      ids[0],
    ]);
    await migrate(pool);
    assert.equal(
      (
        await pool.query("SELECT password_hash FROM profiles WHERE id=$1", [
          ids[0],
        ])
      ).rows[0].password_hash,
      changed,
    );
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
