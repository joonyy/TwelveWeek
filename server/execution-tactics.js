import { z } from "zod";
import { randomUUID } from "node:crypto";
import { transaction } from "./db.js";
import { dateSchema, tacticSchema, planSchema } from "./schema.js";
import {
  addDays,
  evaluationDate,
  prepareWeek,
  weekStart,
  weekGoals,
} from "../shared/domain.js";

const inputSchema = z
  .object({
    version: z.number().int().min(0),
    cycleVersion: z.number().int().min(0),
    goalId: z.uuid(),
    tactic: tacticSchema.optional(),
    sourceTacticId: z.uuid().optional(),
    date: dateSchema,
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    minutes: z.number().int().min(5).max(720),
  })
  .refine(
    (input) => !!input.tactic !== !!input.sourceTacticId,
    "새 전술 또는 기존 전술 하나를 선택해주세요.",
  );

const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const extraInputSchema = z.object({
  version: z.number().int().min(0),
  confirmed: z.literal(true),
  date: dateSchema,
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  minutes: z.number().int().min(5).max(720),
});
export function mountExecutionTacticRoutes(
  app,
  { pool, now, getWeek, present, audit, version },
) {
  app.post(
    "/api/cycles/:cycleId/weeks/:week/tactics/:tacticId/occurrences",
    async (req, res) => {
      const input = extraInputSchema.parse(req.body);
      const result = await transaction(pool, async (db) => {
        const { cycle, week } = await getWeek(db, req, true);
        if (cycle.status !== "active")
          fail(409, "진행 중인 주기에만 실행 횟수를 추가할 수 있어요.");
        version(week.version, input.version);
        const start = weekStart(cycle.start_date, week.number),
          today = evaluationDate(now());
        if (addDays(start, 6) < today)
          fail(409, "지난주의 약속과 평가 기준은 바꿀 수 없어요.");
        if (input.date < start || input.date > addDays(start, 6))
          fail(400, "선택한 주 안에서 실행 날짜를 정해주세요.");
        if (input.date < today)
          fail(409, "새 약속은 오늘 이후의 날짜에 추가해주세요.");
        const state = structuredClone(week.state);
        const tactic = state.tactics.find((t) => t.id === req.params.tacticId);
        if (!tactic) fail(404, "이번 주 전술을 찾을 수 없어요.");
        if (tactic.kind === "daily")
          fail(
            409,
            "매일 전술은 날짜별 1회 약속을 유지해요. 다른 날의 실행으로 대신할 수 없어요.",
          );
        if (
          state.occurrences.filter((o) => o.tacticId === tactic.id).length >=
            50 ||
          state.occurrences.length >= 600
        )
          fail(400, "전술당 최대 50회, 한 주 최대 600회까지 계획할 수 있어요.");
        const fromCount = tactic.plannedCount;
        // Additional executions are optional opportunities, not new minimum
        // commitments. A separate ID namespace survives future baseline edits.
        state.occurrences.push({
          id: `${tactic.id}~extra-${randomUUID()}`,
          tacticId: tactic.id,
          extra: true,
          requiredDate: null,
          date: input.date,
          time: input.time,
          minutes: input.minutes,
          completed: false,
          executedAt: null,
        });
        const updated = (
          await db.query(
            "UPDATE weeks SET state=$1,version=version+1,updated_at=now() WHERE cycle_id=$2 AND number=$3 RETURNING *",
            [JSON.stringify(state), cycle.id, week.number],
          )
        ).rows[0];
        await audit(db, req, cycle, "tactic.occurrence_added", {
          week: week.number,
          tacticId: tactic.id,
          fromCount,
          toCount: fromCount,
          extra: true,
          fromVersion: week.version,
          before: week.state,
          after: state,
        });
        return present(cycle, updated);
      });
      res.status(201).json(result);
    },
  );
  app.post("/api/cycles/:cycleId/weeks/:week/tactics", async (req, res) => {
    const input = inputSchema.parse(req.body);
    const result = await transaction(pool, async (db) => {
      const { cycle, week } = await getWeek(db, req, true);
      if (cycle.status !== "active")
        fail(409, "진행 중인 주기에만 전술을 추가할 수 있어요.");
      version(cycle.version, input.cycleVersion);
      version(week.version, input.version);
      const start = weekStart(cycle.start_date, week.number),
        today = evaluationDate(now());
      if (addDays(start, 6) < today)
        fail(409, "지난주의 전술과 평가 기준은 바꿀 수 없어요.");
      if (input.date < start || input.date > addDays(start, 6))
        fail(400, "선택한 주 안에서 실행 날짜를 정해주세요.");
      const plan = structuredClone(cycle.plan);
      const goal = plan.goals.find((g) => g.id === input.goalId);
      if (!goal) fail(404, "전술을 추가할 목표를 찾을 수 없어요.");
      let tactic;
      if (input.sourceTacticId) {
        tactic = goal.tactics.find((t) => t.id === input.sourceTacticId);
        if (!tactic) fail(404, "선택한 목표의 전술을 찾을 수 없어요.");
      } else {
        tactic = structuredClone(input.tactic);
        if (
          plan.goals.some(
            (g) =>
              g.id === tactic.id || g.tactics.some((t) => t.id === tactic.id),
          )
        )
          fail(409, "이미 추가된 전술이에요. 목록을 다시 불러와주세요.");
        goal.tactics.push(tactic);
      }
      if (!tactic.title.trim() || !tactic.condition.trim())
        fail(400, "전술 이름과 1회 완료 기준을 채워주세요.");
      if (!input.sourceTacticId)
        tactic.weeks = tactic.weeks.filter(
          (number) =>
            number <= cycle.week_count &&
            weekStart(cycle.start_date, number) > today,
        );
      tactic.weeks = [...new Set([...tactic.weeks, week.number])].sort(
        (a, b) => a - b,
      );
      if (week.state.tactics.some((t) => t.id === tactic.id))
        fail(
          409,
          "이미 이번 주 목록에 있는 전술이에요. 기존 실행 회차를 선택해주세요.",
        );
      planSchema.parse(plan);
      const changed = (
        await db.query(
          "UPDATE cycles SET plan=$1,version=version+1,updated_at=now() WHERE id=$2 RETURNING *",
          [JSON.stringify(plan), cycle.id],
        )
      ).rows[0];
      const weeks = (
        await db.query(
          "SELECT * FROM weeks WHERE cycle_id=$1 ORDER BY number FOR UPDATE",
          [cycle.id],
        )
      ).rows;
      let selected = week;
      for (const row of weeks) {
        let state;
        const future = weekStart(cycle.start_date, row.number) > today;
        if (future && row.number <= cycle.week_count)
          state = prepareWeek(plan, cycle.start_date, row.number, row.state);
        if (row.number === week.number) {
          state = state ?? structuredClone(row.state);
          const snapshot = prepareWeek(
            {
              ...plan,
              goals: [
                { ...goal, tactics: [{ ...tactic, weeks: [week.number] }] },
              ],
            },
            cycle.start_date,
            week.number,
          );
          const addedTactic = snapshot.tactics[0];
          let addedOccurrences = snapshot.occurrences;
          if (future) {
            // The future baseline already contains this tactic; use its generated occurrences.
            addedOccurrences = state.occurrences.filter(
              (o) => o.tacticId === tactic.id,
            );
          } else {
            state.tactics.push(addedTactic);
            state.occurrences.push(...addedOccurrences);
            state.goals ??= weekGoals(row.state);
            if (!state.goals.some((g) => g.id === goal.id))
              state.goals.push(snapshot.goals[0]);
          }
          const occurrence = addedOccurrences.find(
            (o) => !o.requiredDate || o.requiredDate === input.date,
          );
          if (!occurrence)
            fail(400, "해당 날짜에 배치할 실행을 찾을 수 없어요.");
          Object.assign(occurrence, {
            date: input.date,
            time: input.time,
            minutes: input.minutes,
          });
          // Future occurrences above are references to state; current occurrences are appended as references too.
        }
        if (state) {
          if (state.occurrences.length > 600)
            fail(400, "한 주에 배치할 실행이 너무 많아요.");
          const updated = (
            await db.query(
              "UPDATE weeks SET state=$1,version=version+1,updated_at=now() WHERE cycle_id=$2 AND number=$3 RETURNING *",
              [JSON.stringify(state), cycle.id, row.number],
            )
          ).rows[0];
          if (row.number === week.number) selected = updated;
        }
      }
      await audit(db, req, cycle, "tactic.added_from_execution", {
        week: week.number,
        tacticId: tactic.id,
        goalId: goal.id,
        fromVersion: cycle.version,
        before: cycle.plan,
        after: plan,
        beforeWeek: week.state,
        afterWeek: selected.state,
      });
      return { cycle: changed, week: present(changed, selected) };
    });
    res.status(201).json(result);
  });
}
