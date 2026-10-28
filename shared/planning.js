import { VISION_AREAS, visionItems } from "./vision-links.js";
const uid = () => crypto.randomUUID();
export const VISION_MODES = {
  longVision: "list",
  personalVision: "list",
  careerVision: "list",
};
export const COMMITMENT_AREAS = [
  "배우자·연인과의 관계",
  "가족",
  "공동체",
  "건강",
  "사적인 영역",
  "비즈니스",
  "종교",
];
export const newTactic = (weekCount = 12) => ({
  id: uid(),
  title: "",
  condition: "",
  kind: "weekly",
  count: 1,
  weeks: Array.from({ length: weekCount }, (_, i) => i + 1),
});
export const newGoal = (weekCount = 12) => ({
  id: uid(),
  title: "",
  success: "",
  benefit: "",
  leading: "",
  lagging: "",
  measurement: "",
  visionLinks: [],
  tactics: [newTactic(weekCount)],
  difficulties: [{ id: uid(), tacticId: "", obstacle: "", response: "" }],
});
export const newCommitment = (area) => ({
  id: uid(),
  area,
  promise: "",
  action: "",
  cost: "",
  choice: "",
  accepted: false,
});
export const initialCommitments = () =>
  COMMITMENT_AREAS.flatMap((area) =>
    Array.from({ length: 3 }, () => newCommitment(area)),
  );
export function hasTacticContent(t) {
  return !!(t.title.trim() || t.condition.trim());
}
export function hasGoalContent(g) {
  return (
    ["title", "success", "benefit", "leading", "lagging", "measurement"].some(
      (k) => g[k]?.trim(),
    ) ||
    g.tactics.some(hasTacticContent) ||
    g.difficulties.some((d) => d.obstacle.trim() || d.response.trim())
  );
}
// Add missing editor structure in memory; existing content is never overwritten.
export function editablePlan(plan, { draft = true, weekCount = 12 } = {}) {
  const copy = structuredClone(plan);
  copy.visionModes = { ...VISION_MODES, ...copy.visionModes };
  copy.visionItems = Object.fromEntries(
    VISION_AREAS.map(({ key }) => [
      key,
      visionItems(copy[key], copy.visionItems?.[key]),
    ]),
  );
  copy.responsibilityActions = {
    personal: "",
    business: "",
    ...copy.responsibilityActions,
  };
  if (draft && !copy.goals.length)
    copy.goals = Array.from({ length: 3 }, () => newGoal(weekCount));
  copy.goals = copy.goals.map((g) => ({
    ...g,
    visionLinks: g.visionLinks ?? [],
    tactics: g.tactics.length ? g.tactics : [newTactic(weekCount)],
    difficulties: g.difficulties.length
      ? g.difficulties
      : [{ id: uid(), tacticId: "", obstacle: "", response: "" }],
  }));
  copy.commitments = copy.commitments.map((c) => ({
    ...c,
    accepted: c.accepted ?? false,
  }));
  for (const area of COMMITMENT_AREAS) {
    const count = copy.commitments.filter((c) => c.area === area).length;
    for (let i = count; i < 3; i++) copy.commitments.push(newCommitment(area));
  }
  return copy;
}
export function planWithinWeeks(plan, weekCount) {
  return {
    ...plan,
    ...(plan.weeklyModelWeeks
      ? {
          weeklyModelWeeks: plan.weeklyModelWeeks.filter(
            (w) => w.week <= weekCount,
          ),
        }
      : {}),
    goals: plan.goals.map((g) => ({
      ...g,
      tactics: g.tactics.map((t) => ({
        ...t,
        weeks: t.weeks.filter((w) => w <= weekCount),
      })),
    })),
  };
}
export function calendarOffset(time) {
  const [h, m] = time.split(":").map(Number);
  return (h * 60 + m - 240 + 1440) % 1440;
}
export const modelWeekFor = (plan, week) =>
  plan.weeklyModelWeeks?.find((w) => w.week === week)?.blocks ?? plan.modelWeek;
// Keep the previous Sunday's overnight block when it continues past Monday 04:00.
// day -1 is a display/export reference only, never a stored execution or model block.
export function timetableForWeek(plan, week) {
  const previous = modelWeekFor(plan, week - 1);
  return [
    ...previous
      .filter(
        (block) =>
          block.day === 6 && calendarOffset(block.time) + block.minutes > 1440,
      )
      .map((block) => ({ ...block, day: -1, sourceWeek: week - 1 })),
    ...modelWeekFor(plan, week).map((block) => ({
      ...block,
      sourceWeek: week,
    })),
  ];
}
export function withWeekModel(
  plan,
  week,
  blocks,
  { applyToDefault = false, preserveWeeks = [], reset = false } = {},
) {
  const weeks = new Map(
    (plan.weeklyModelWeeks ?? []).map((w) => [w.week, structuredClone(w)]),
  );
  if (applyToDefault)
    for (const number of preserveWeeks)
      if (!weeks.has(number))
        weeks.set(number, {
          week: number,
          blocks: structuredClone(plan.modelWeek),
        });
  if (reset) weeks.delete(week);
  else weeks.set(week, { week, blocks: structuredClone(blocks) });
  return {
    ...plan,
    ...(applyToDefault
      ? {
          modelWeek: structuredClone(blocks).map(
            ({ templateOrigin, ...block }) => block,
          ),
        }
      : {}),
    weeklyModelWeeks: [...weeks.values()].sort((a, b) => a.week - b.week),
  };
}
export function timeAtOffset(offset) {
  const minutes = (offset + 240) % 1440;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
// Keep the opposite edge fixed; a resize never changes the evaluation day.
export function resizeCalendarBlock(block, edge, delta, { wrap = true } = {}) {
  const start = calendarOffset(block.time),
    end = start + block.minutes;
  if (edge === "start") {
    const next = Math.max(
      Math.max(0, end - 720),
      Math.min(end - 5, 1439, start + delta),
    );
    return { time: timeAtOffset(next), minutes: end - next };
  }
  const limit = !wrap && block.day === 6 ? 1440 : Infinity;
  if (start + 5 > limit) return { time: block.time, minutes: block.minutes };
  return {
    time: block.time,
    minutes:
      Math.max(start + 5, Math.min(start + 720, limit, end + delta)) - start,
  };
}
// The reusable model week wraps Sunday into Monday, including blocks across 04:00.
export function calendarFragments(blocks, { wrap = true } = {}) {
  const pieces = [];
  for (const block of blocks) {
    const start = calendarOffset(block.time),
      end = start + block.minutes;
    pieces.push({ ...block, start, end: Math.min(1440, end), part: 0 });
    if (end > 1440 && (wrap || block.day < 6))
      pieces.push({
        ...block,
        day: (block.day + 1) % 7,
        start: 0,
        end: end - 1440,
        part: 1,
      });
  }
  return pieces;
}
export function calendarLanes(blocks) {
  const result = [];
  for (let day = 0; day < 7; day++) {
    const sorted = blocks
      .filter((b) => b.day === day && !b.background)
      .sort((a, b) => a.start - b.start || b.end - a.end);
    let group = [],
      end = -1;
    function flush() {
      const lanes = [];
      for (const block of group) {
        let lane = lanes.findIndex((e) => e <= block.start);
        if (lane < 0) lane = lanes.length;
        lanes[lane] = block.end;
        block.lane = lane;
      }
      result.push(...group.map((b) => ({ ...b, lanes: lanes.length })));
      group = [];
    }
    for (const block of sorted) {
      if (block.start >= end) {
        flush();
        end = -1;
      }
      group.push({ ...block });
      end = Math.max(end, block.end);
    }
    flush();
  }
  return [
    ...blocks
      .filter((b) => b.background)
      .map((b) => ({ ...b, lane: 0, lanes: 1 })),
    ...result,
  ];
}
