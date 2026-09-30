import {
  newGoal,
  initialCommitments,
  VISION_MODES,
  hasGoalContent,
  hasTacticContent,
} from "./planning.js";
export const DEFAULT_START = "2026-10-05";
export function dateOnly(value) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}
export function addDays(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function daysBetween(a, b) {
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000,
  );
}
export function evaluationDate(instant = new Date()) {
  return new Date(new Date(instant).getTime() + 5 * 3600000)
    .toISOString()
    .slice(0, 10);
}
export function weekStart(start, week) {
  return addDays(start, (week - 1) * 7);
}
export function currentWeek(start, instant = new Date()) {
  return Math.min(
    13,
    Math.max(
      0,
      Math.floor(daysBetween(start, evaluationDate(instant)) / 7) + 1,
    ),
  );
}
export function calendarInstant(date, time) {
  return new Date(
    `${Number(time.slice(0, 2)) < 4 ? addDays(date, 1) : date}T${time}:00+09:00`,
  );
}
export function emptyPlan() {
  return {
    longVision: "",
    personalVision: "",
    careerVision: "",
    visionModes: { ...VISION_MODES },
    goals: Array.from({ length: 3 }, newGoal),
    modelWeek: [],
    responsibility: "",
    responsibilityActions: { personal: "", business: "" },
    pastCommitments: [
      { promise: "", action: "", benefit: "" },
      { promise: "", action: "", benefit: "" },
    ],
    commitments: initialCommitments(),
  };
}
export function prepareWeek(plan, start, number, previous) {
  const date = weekStart(start, number);
  const populatedGoals = plan.goals.filter(hasGoalContent);
  const goals = populatedGoals.map(
    ({ id, title, leading, lagging, measurement }) => ({
      id,
      title,
      leading,
      lagging,
      measurement,
    }),
  );
  const tactics = populatedGoals.flatMap((g) =>
    g.tactics
      .filter((t) => hasTacticContent(t) && t.weeks.includes(number))
      .map((t) => ({
        ...t,
        goalId: g.id,
        goalTitle: g.title,
        goalLeading: g.leading,
        goalLagging: g.lagging,
        goalMeasurement: g.measurement,
        plannedCount: t.kind === "daily" ? 7 : t.kind === "once" ? 1 : t.count,
      })),
  );
  const occurrences = tactics.flatMap((t) =>
    Array.from({ length: t.plannedCount }, (_, i) => {
      const id = `${t.id}~${i}`;
      const old = previous?.occurrences.find((o) => o.id === id);
      const requiredDate = t.kind === "daily" ? addDays(date, i) : null;
      return {
        id,
        tacticId: t.id,
        requiredDate,
        date: requiredDate ?? old?.date ?? null,
        time: old?.time ?? "09:00",
        minutes: old?.minutes ?? 60,
        completed: false,
        executedAt: null,
      };
    }),
  );
  return {
    goals,
    tactics,
    occurrences,
    review: previous?.review
      ? {
          ...previous.review,
          metrics: Object.fromEntries(
            Object.entries(previous.review.metrics).filter(([id]) =>
              goals.some((g) => g.id === id),
            ),
          ),
        }
      : { learned: "", next: "", metrics: {} },
    reviewSavedAt: null,
  };
}
export function weekGoals(state) {
  return (
    state.goals ?? [
      ...new Map(
        state.tactics.map((t) => [
          t.goalId,
          {
            id: t.goalId,
            title: t.goalTitle,
            leading: t.goalLeading,
            lagging: t.goalLagging,
            measurement: t.goalMeasurement,
          },
        ]),
      ).values(),
    ]
  );
}
export function scoreWeek(state) {
  const rows = state.tactics.map((t) => {
    const done = state.occurrences.filter(
      (o) => o.tacticId === t.id && o.completed,
    ).length;
    const rate = Math.min(1, done / t.plannedCount);
    return {
      ...t,
      done,
      rate,
      complete: done >= t.plannedCount,
      weight: 100 / state.tactics.length,
      contribution: (100 / state.tactics.length) * rate,
    };
  });
  return {
    rows,
    score: rows.length ? rows.reduce((s, t) => s + t.contribution, 0) : null,
  };
}
export function scoreDay(state, date) {
  const planned = state.occurrences.filter((o) => o.date === date);
  const done = planned.filter((o) => o.completed).length;
  return {
    planned: planned.length,
    done,
    score: planned.length ? (done / planned.length) * 100 : null,
  };
}
export const percentage = (value) =>
  value == null ? "평가 없음" : `${Number(value.toFixed(1))}%`;
export const PRINCIPLES = [
  {
    id: "vision",
    name: "비전",
    type: "행동",
    text: "내가 원하는 삶과 이번 목표를 연결합니다. 장기 비전에서는 가능성을 넓게 상상하세요.",
  },
  {
    id: "plan",
    name: "계획",
    type: "행동",
    text: "목표에 꼭 필요한 전술과 실행 주차를 정합니다. 준비 항목이 계속 늘어나면 필수인지 다시 살펴보세요.",
  },
  {
    id: "process",
    name: "프로세스 관리",
    type: "행동",
    text: "의지만으로 버티지 않도록 주간 계획과 실행을 돕는 구조를 만듭니다.",
  },
  {
    id: "measure",
    name: "평가",
    type: "행동",
    text: "실행한 행동과 달라진 결과를 함께 봅니다. 점수는 다음 판단을 위한 정보입니다.",
  },
  {
    id: "time",
    name: "시간 활용",
    type: "행동",
    text: "중요한 활동에 시간을 배정하고 회복할 시간도 확보합니다.",
  },
  {
    id: "ownership",
    name: "책임",
    type: "사고",
    text: "현재 상황에서 내가 선택하고 조정할 수 있는 행동을 찾습니다. 자기비하로 평가를 대신하지 않습니다.",
  },
  {
    id: "commitment",
    name: "헌신",
    type: "사고",
    text: "자신과의 약속에 필요한 행동과 비용을 확인하고, 감당할 수 있는 약속을 선택합니다.",
  },
  {
    id: "moment",
    name: "위대해지는 순간",
    type: "사고",
    text: "결과가 나오기 전에도, 지금 필요한 행동을 하겠다고 결심하는 순간에 의미가 있습니다.",
  },
];
