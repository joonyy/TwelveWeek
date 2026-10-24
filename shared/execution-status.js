import { hasScheduledTime } from "./domain.js";

// Completion and placement are separate facts. A missing time does not mean
// failure until the promised evaluation date (or the whole week) has ended.
export function executionStatus(occurrence, { today, weekEnd }) {
  if (occurrence.completed) return "completed";
  if (weekEnd < today || (occurrence.date && occurrence.date < today))
    return "missed";
  return hasScheduledTime(occurrence) ? "scheduled" : "unplaced";
}

export function summarizeExecutions(occurrences, context) {
  const counts = {
    total: occurrences.length,
    completed: 0,
    missed: 0,
    scheduled: 0,
    unplaced: 0,
  };
  for (const occurrence of occurrences)
    counts[executionStatus(occurrence, context)] += 1;
  return counts;
}
