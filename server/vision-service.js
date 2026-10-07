import { randomUUID } from "node:crypto";
import { z } from "zod";
import { transaction } from "./db.js";
import { VISION_GUIDANCE } from "../shared/vision-ai.js";
export const failAI = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
export function createVisionService({ pool, now = () => new Date() }) {
  const owned = async (db, profileId, cycleId, lock = false) => {
    z.uuid().parse(cycleId);
    const row = (
      await db.query(
        `SELECT * FROM cycles WHERE id=$1 AND profile_id=$2${lock ? " FOR UPDATE" : ""}`,
        [cycleId, profileId],
      )
    ).rows[0];
    if (!row) failAI(404, "주기를 찾을 수 없어요.");
    return row;
  };
  const permission = async (db, cycleId) =>
    (
      await db.query(
        "SELECT allow_write FROM ai_vision_permissions WHERE cycle_id=$1",
        [cycleId],
      )
    ).rows[0]?.allow_write || false;
  const write = async (
    db,
    {
      profileId,
      cycleId,
      version,
      vision,
      actor,
      conversationId = null,
      requirePermission = true,
    },
  ) => {
    z.string().max(6000).parse(vision);
    const cycle = await owned(db, profileId, cycleId, true);
    if (cycle.status === "complete")
      failAI(409, "마친 주기의 비전은 변경할 수 없어요.");
    if (cycle.version !== version)
      failAI(
        409,
        "비전이나 계획이 변경됐어요. 최신 내용을 확인한 뒤 다시 반영해주세요.",
      );
    if (requirePermission && !(await permission(db, cycleId)))
      failAI(403, "장기비전 수정 권한이 없거나 철회됐어요.");
    if (cycle.plan.longVision === vision) return { cycle, edit: null };
    const editId = randomUUID();
    const changed = (
      await db.query(
        "UPDATE cycles SET plan=jsonb_set(plan,'{longVision}',to_jsonb($1::text)),version=version+1,updated_at=$2 WHERE id=$3 RETURNING *",
        [vision, now(), cycleId],
      )
    ).rows[0];
    const edit = (
      await db.query(
        "INSERT INTO ai_vision_edits(id,cycle_id,profile_id,conversation_id,actor,before_text,after_text,from_version,to_version,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
        [
          editId,
          cycleId,
          profileId,
          conversationId,
          actor,
          cycle.plan.longVision,
          vision,
          cycle.version,
          changed.version,
          now(),
        ],
      )
    ).rows[0];
    await db.query(
      "INSERT INTO changes(profile_id,cycle_id,kind,detail) VALUES($1,$2,'vision.ai_updated',$3)",
      [
        profileId,
        cycleId,
        JSON.stringify({
          editId,
          actor,
          before: cycle.plan.longVision,
          after: vision,
          fromVersion: cycle.version,
        }),
      ],
    );
    return { cycle: changed, edit };
  };
  return {
    owned,
    permission,
    write,
    async context(profileId, cycleId) {
      const cycle = await owned(pool, profileId, cycleId);
      return {
        cycleId,
        title: cycle.title,
        version: cycle.version,
        longVision: cycle.plan.longVision,
        allowWrite: await permission(pool, cycleId),
        guidance: VISION_GUIDANCE,
      };
    },
    async grant(profileId, cycleId, allowWrite) {
      return transaction(pool, async (db) => {
        const cycle = await owned(db, profileId, cycleId, true);
        if (allowWrite && cycle.status === "complete")
          failAI(409, "마친 주기에 수정 권한을 줄 수 없어요.");
        await db.query(
          "INSERT INTO ai_vision_permissions(cycle_id,allow_write,updated_at) VALUES($1,$2,$3) ON CONFLICT(cycle_id) DO UPDATE SET allow_write=$2,updated_at=$3",
          [cycleId, allowWrite, now()],
        );
        return { allowWrite };
      });
    },
    async edits(profileId, cycleId) {
      await owned(pool, profileId, cycleId);
      return (
        await pool.query(
          "SELECT * FROM ai_vision_edits WHERE cycle_id=$1 ORDER BY to_version DESC LIMIT 30",
          [cycleId],
        )
      ).rows;
    },
    async apply(input) {
      return transaction(pool, (db) => write(db, input));
    },
    async undo(profileId, cycleId, editId, version) {
      return transaction(pool, async (db) => {
        const cycle = await owned(db, profileId, cycleId, true);
        const edit = (
          await db.query(
            "SELECT * FROM ai_vision_edits WHERE id=$1 AND cycle_id=$2 AND profile_id=$3 FOR UPDATE",
            [z.uuid().parse(editId), cycleId, profileId],
          )
        ).rows[0];
        if (!edit) failAI(404, "수정 기록을 찾을 수 없어요.");
        if (
          cycle.status === "complete" ||
          edit.undone_at ||
          cycle.version !== version ||
          cycle.plan.longVision !== edit.after_text
        )
          failAI(
            409,
            "이후 비전이 변경됐어요. 최신 수정부터 되돌리거나 내용을 직접 편집해주세요.",
          );
        const changed = (
          await db.query(
            "UPDATE cycles SET plan=jsonb_set(plan,'{longVision}',to_jsonb($1::text)),version=version+1,updated_at=$2 WHERE id=$3 RETURNING *",
            [edit.before_text, now(), cycleId],
          )
        ).rows[0];
        await db.query("UPDATE ai_vision_edits SET undone_at=$1 WHERE id=$2", [
          now(),
          editId,
        ]);
        await db.query(
          "INSERT INTO changes(profile_id,cycle_id,kind,detail) VALUES($1,$2,'vision.ai_undone',$3)",
          [
            profileId,
            cycleId,
            JSON.stringify({ editId, fromVersion: cycle.version }),
          ],
        );
        return changed;
      });
    },
  };
}
