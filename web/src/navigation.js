const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const keys = [
  "cycle",
  "view",
  "tab",
  "planView",
  "planWeek",
  "goal",
  "week",
  "mode",
  "day",
];

// Only navigation belongs in the address. Forms, tokens and execution data stay out.
export function readNavigation(cycleId) {
  const params = new URLSearchParams(location.hash.slice(1));
  const cycle = params.get("cycle");
  if (!cycle || !uuid.test(cycle) || (cycleId && cycle !== cycleId)) return {};
  const number = (key, max) => {
    const raw = params.get(key);
    const value = raw && /^\d+$/.test(raw) ? Number(raw) : NaN;
    return Number.isInteger(value) && value >= 0 && value <= max
      ? value
      : undefined;
  };
  const day = params.get("day");
  const validDay =
    day &&
    /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    !Number.isNaN(Date.parse(day)) &&
    new Date(day).toISOString().slice(0, 10) === day;
  return {
    cycle,
    view: ["plan", "week"].includes(params.get("view"))
      ? params.get("view")
      : undefined,
    tab: number("tab", 4),
    planView: ["goal", "week"].includes(params.get("planView"))
      ? params.get("planView")
      : undefined,
    planWeek: number("planWeek", 12),
    goal: uuid.test(params.get("goal") || "") ? params.get("goal") : undefined,
    week: number("week", 13),
    mode: ["plan", "day", "schedule", "review"].includes(params.get("mode"))
      ? params.get("mode")
      : undefined,
    day: validDay ? day : undefined,
  };
}

export function writeNavigation(next) {
  const previous = readNavigation(next.cycle);
  const params = new URLSearchParams();
  const values = { ...previous, ...next };
  for (const key of keys) {
    if (values[key] !== undefined && values[key] !== null)
      params.set(key, values[key]);
  }
  const url = new URL(location.href);
  url.hash = params.toString();
  if (url.href !== location.href) history.replaceState(history.state, "", url);
}

export function clearNavigation() {
  const url = new URL(location.href);
  url.hash = "";
  history.replaceState(history.state, "", url);
}
