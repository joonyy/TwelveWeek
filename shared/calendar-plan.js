import { addDays, calendarInstant, evaluationDate } from "./domain.js";

export function calendarRange(start, number) {
  const date = addDays(start, (number - 1) * 7);
  return {
    date,
    start: calendarInstant(date, "04:00").toISOString(),
    end: calendarInstant(addDays(date, 7), "04:00").toISOString(),
  };
}
export function placementRange(p) {
  if (!p.date) return null;
  const start = +calendarInstant(p.date, p.time);
  return { start, end: start + p.minutes * 60000 };
}
const overlaps = (a, b) => a.start < b.end && b.start < a.end;
export function linkedPlacement(event, range, requiredDate, minutes) {
  const lower = requiredDate
    ? +calendarInstant(requiredDate, "04:00")
    : +new Date(range.start);
  const upper = requiredDate
    ? +calendarInstant(addDays(requiredDate, 1), "04:00")
    : +new Date(range.end);
  const start = Math.max(lower, +new Date(event.start));
  const end = Math.min(upper, +new Date(event.end));
  if (end - start < 5 * 60000) return null;
  return {
    date: evaluationDate(new Date(start)),
    time: new Date(start + 9 * 3600000).toISOString().slice(11, 16),
    minutes: Math.min(minutes, Math.floor((end - start) / 60000), 720),
  };
}
export function placementConflicts(placements, events) {
  return Object.fromEntries(
    placements.map((p) => {
      const window = p.action !== "skip" && placementRange(p);
      const conflicts = [];
      if (window) {
        for (const e of events) {
          if (e.transparent || (p.action === "link" && p.linkId === e.id))
            continue;
          if (
            overlaps(window, {
              start: +new Date(e.start),
              end: +new Date(e.end),
            })
          )
            conflicts.push({ source: "apple", id: e.id, title: e.title });
        }
        for (const other of placements) {
          if (other.occurrenceId === p.occurrenceId || other.action === "skip")
            continue;
          if (
            p.action === "link" &&
            other.action === "link" &&
            p.linkId === other.linkId
          )
            continue;
          const range = placementRange(other);
          if (range && overlaps(window, range))
            conflicts.push({ source: "plan", id: other.occurrenceId });
        }
      }
      return [p.occurrenceId, conflicts];
    }),
  );
}

// Calendar display uses evaluation days beginning at 04:00, including overnight events.
export function appleCalendarBlocks(events, range) {
  const origin = +new Date(range.start),
    limit = +new Date(range.end);
  return events.flatMap((e) => {
    const blocks = [];
    let start = Math.max(origin, +new Date(e.start));
    const end = Math.min(limit, +new Date(e.end));
    while (start < end) {
      const day = Math.floor((start - origin) / 86400000);
      const stop = Math.min(end, origin + (day + 1) * 86400000);
      const local = new Date(start + 9 * 3600000).toISOString();
      blocks.push({
        id: `apple-${e.id}-${day}`,
        eventId: e.id,
        day,
        time: local.slice(11, 16),
        minutes: (stop - start) / 60000,
        title: `[${e.calendarName}] ${e.title}`,
        kind: "fixed",
        locked: true,
      });
      start = stop;
    }
    return blocks;
  });
}
