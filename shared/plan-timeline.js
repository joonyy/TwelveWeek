import { hasGoalContent, hasTacticContent } from "./planning.js";

export function planTimeline(plan, weekCount) {
  const totals = Array(weekCount).fill(0);
  const goals = plan.goals.filter(hasGoalContent).map((goal) => ({
    id: goal.id,
    title: goal.title,
    tactics: goal.tactics.filter(hasTacticContent).map((tactic) => {
      const weeks = [
        ...new Set(
          tactic.weeks.filter(
            (w) => Number.isInteger(w) && w >= 1 && w <= weekCount,
          ),
        ),
      ].sort((a, b) => a - b);
      const minimum =
        tactic.kind === "daily" ? 7 : tactic.kind === "once" ? 1 : tactic.count;
      const segments = [];
      for (const week of weeks) {
        totals[week - 1] += minimum;
        const last = segments.at(-1);
        if (last && last.end === week - 1) last.end = week;
        else segments.push({ start: week, end: week });
      }
      return { ...tactic, weeks, minimum, segments };
    }),
  }));
  return { goals, totals };
}
