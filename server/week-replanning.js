import { randomUUID } from "node:crypto";
import { z } from "zod";
import { transaction } from "./db.js";
import { evaluationDate, weekStart, addDays } from "../shared/domain.js";
import { REPLAN_REASONS, replanWeek } from "../shared/week-replanning.js";

const inputSchema = z
  .object({
    version: z.number().int().min(0),
    cycleVersion: z.number().int().min(0),
    effectiveDate: z.string(),
    reason: z.enum(Object.keys(REPLAN_REASONS)),
    note: z.string().trim().min(1).max(2000),
    keepIds: z.array(z.string().max(160)).max(600),
    additions: z
      .array(
        z.object({
          goalId: z.uuid(),
          title: z.string().trim().min(1).max(300),
          condition: z.string().trim().min(1).max(2000),
          kind: z.enum(["weekly", "daily"]),
          count: z.number().int().min(1).max(50),
        }),
      )
      .max(20),
    confirmed: z.literal(true),
  })
  .strict();

export function mountWeekReplanning(
  app,
  { pool, now, getWeek, present, audit, version },
) {
  app.post("/api/cycles/:cycleId/weeks/:week/replan", async (req, res) => {
    const input = inputSchema.parse(req.body);
    const result = await transaction(pool, async (db) => {
      const { cycle, week } = await getWeek(db, req, true);
      version(week.version, input.version);
      version(cycle.version, input.cycleVersion);
      const at = now();
      const today = evaluationDate(at);
      const start = weekStart(cycle.start_date, week.number);
      if (
        cycle.status !== "active" ||
        today < start ||
        today > addDays(start, 6)
      )
        throw Object.assign(
          new Error("현재 진행 중인 주만 재정립할 수 있어요."),
          { status: 409 },
        );
      if (input.effectiveDate !== today)
        throw Object.assign(
          new Error(
            "평가 날짜가 바뀌었어요. 새로 불러온 뒤 다시 확인해주세요.",
          ),
          { status: 409 },
        );
      const state = replanWeek(week.state, input, {
        today,
        at: at.toISOString(),
        id: randomUUID(),
        newId: randomUUID,
        end: addDays(start, 6),
        goals: [...cycle.plan.goals, ...(week.state.goals || [])],
      });
      const updated = (
        await db.query(
          "UPDATE weeks SET state=$1,version=version+1,updated_at=now() WHERE cycle_id=$2 AND number=$3 RETURNING *",
          [JSON.stringify(state), cycle.id, week.number],
        )
      ).rows[0];
      await audit(db, req, cycle, "week.replanned", {
        week: week.number,
        fromVersion: week.version,
        revision: state.replans.at(-1),
      });
      return present(cycle, updated);
    });
    res.status(201).json(result);
  });
}
