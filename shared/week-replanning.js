import { addDays, scoreWeek, weekGoals } from "./domain.js";

export const REPLAN_REASONS = {
  work: "근무·생활 조건 변경",
  recovery: "건강·회복 조건 변경",
  priorities: "목표·우선순위 변경",
  other: "그 밖의 상황 변화",
};

// An evaluation day closes at 04:00 KST. Today's unfinished actions are still
// editable; completed actions and closed evaluation days become history.
export const canReplanOccurrence = (o, today) =>
  !o.completed && (!o.date || o.date >= today);

export function replanWeek(state, input, { today, at, id, newId, goals, end }) {
  const fail = (message) => {
    throw Object.assign(new Error(message), { status: 400 });
  };
  const eligible = state.occurrences.filter((o) =>
    canReplanOccurrence(o, today),
  );
  const keep = new Set(input.keepIds);
  if (
    keep.size !== input.keepIds.length ||
    [...keep].some((key) => !eligible.some((o) => o.id === key))
  )
    fail("오늘 이후의 미완료 실행만 유지 대상으로 선택해주세요.");
  const occurrences = structuredClone(eligible.filter((o) => keep.has(o.id)));
  const tactics = structuredClone(state.tactics)
    .map((t) => ({
      ...t,
      plannedCount: occurrences.filter((o) => o.tacticId === t.id && !o.extra)
        .length,
    }))
    .filter((t) => occurrences.some((o) => o.tacticId === t.id));
  const nextGoals = structuredClone(weekGoals(state));
  for (const addition of input.additions) {
    const goal = goals.find((g) => g.id === addition.goalId);
    if (!goal?.title?.trim()) fail("새 약속의 목표를 확인해주세요.");
    if (!nextGoals.some((g) => g.id === goal.id))
      nextGoals.push({
        id: goal.id,
        title: goal.title,
        leading: goal.leading || "",
        lagging: goal.lagging || "",
        measurement: goal.measurement || "",
      });
    const tacticId = newId();
    const dates =
      addition.kind === "daily"
        ? Array.from(
            {
              length:
                Math.round((Date.parse(end) - Date.parse(today)) / 86400000) +
                1,
            },
            (_, i) => addDays(today, i),
          )
        : Array(addition.count).fill(null);
    tactics.push({
      id: tacticId,
      title: addition.title,
      condition: addition.condition,
      kind: addition.kind,
      count: addition.count,
      plannedCount: dates.length,
      weeks: [],
      goalId: goal.id,
      goalTitle: goal.title,
      goalLeading: goal.leading || "",
      goalLagging: goal.lagging || "",
      goalMeasurement: goal.measurement || "",
    });
    occurrences.push(
      ...dates.map((date, i) => ({
        id: `${tacticId}~${i}`,
        tacticId,
        requiredDate: date,
        date,
        time: "09:00",
        minutes: 60,
        completed: false,
        executedAt: null,
      })),
    );
  }
  if (occurrences.length > 600)
    fail("한 주에 실행은 최대 600회까지 설정할 수 있어요.");
  if ((state.replans?.length || 0) >= 20)
    fail("한 주에 재정립 이력은 최대 20회까지 남길 수 있어요.");
  const { replans, ...snapshot } = structuredClone(state);
  const revision = {
    id,
    at,
    effectiveDate: today,
    reason: input.reason,
    note: input.note,
    keptIds: [...keep],
    addedCount: occurrences.length - keep.size,
    removedCount: eligible.length - keep.size,
    snapshot,
    score: scoreWeek(snapshot),
  };
  return {
    ...state,
    goals: nextGoals,
    tactics,
    occurrences,
    tacticCounts: {},
    replans: [...(replans || []), revision],
  };
}

// Latest copy wins for carried actions. This also keeps reading drafts and
// completed executions available after they leave the working plan.
export function weekRecords(state) {
  const records = new Map();
  for (const phase of [...(state.replans || []).map((r) => r.snapshot), state])
    for (const occurrence of phase.occurrences)
      records.set(occurrence.id, {
        occurrence,
        tactic: phase.tactics.find((t) => t.id === occurrence.tacticId),
      });
  return [...records.values()];
}

export function calendarWeekState(state) {
  if (!state.replans?.length) return state;
  const liveIds = new Set(state.occurrences.map((o) => o.id));
  const archived = new Map();
  for (const revision of state.replans)
    for (const o of revision.snapshot.occurrences)
      if (
        !liveIds.has(o.id) &&
        (o.completed || (o.date && o.date < revision.effectiveDate))
      )
        archived.set(o.id, {
          occurrence: o,
          tactic: revision.snapshot.tactics.find((t) => t.id === o.tacticId),
        });
  const historical = [...archived.values()];
  const tactics = [...state.tactics];
  for (const { tactic } of historical)
    if (tactic && !tactics.some((t) => t.id === tactic.id))
      tactics.push(tactic);
  return {
    ...state,
    tactics,
    occurrences: [...historical.map((r) => r.occurrence), ...state.occurrences],
  };
}

export function stateForDay(state, date) {
  return state.replans?.find((r) => date < r.effectiveDate)?.snapshot || state;
}
