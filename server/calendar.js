import {
  addDays,
  calendarInstant,
  weekStart,
  hasScheduledTime,
} from "../shared/domain.js";
import { timetableForWeek } from "../shared/planning.js";
const escape = (s) =>
  String(s)
    .replaceAll("\\", "\\\\")
    .replaceAll("\r", "")
    .replaceAll("\n", "\\n")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,");
const stamp = (d) =>
  d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
function fold(line) {
  let out = "",
    current = "",
    bytes = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (bytes + n > 75) {
      out += current + "\r\n";
      current = " ";
      bytes = 1;
    }
    current += ch;
    bytes += n;
  }
  return out + current;
}
export function calendar(cycle, week, now = new Date()) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Twelve//12 Week Plan//KO",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escape(`${week.number}주차 시간표`)}`,
  ];
  const startDate =
    week.start ||
    (cycle.start_date && weekStart(cycle.start_date, week.number));
  if (cycle.plan && startDate) {
    for (const block of timetableForWeek(cycle.plan, week.number)) {
      const date = addDays(startDate, block.day);
      const start = calendarInstant(date, block.time);
      const source = cycle.plan.weeklyModelWeeks?.some(
        (entry) => entry.week === block.sourceWeek,
      )
        ? "주차별 시간표"
        : "모범 주간에서 가져온 시간표";
      lines.push(
        "BEGIN:VEVENT",
        `UID:${cycle.id}-${block.sourceWeek}-timetable-${block.id}@twelve.local`,
        `DTSTAMP:${stamp(now)}`,
        `SEQUENCE:${cycle.version ?? 0}`,
        `DTSTART:${stamp(start)}`,
        `DTEND:${stamp(new Date(+start + block.minutes * 60000))}`,
        `SUMMARY:${escape(block.title)}`,
        `DESCRIPTION:${escape(`${week.number}주차 · ${source}${block.day < 0 ? " · 전주에서 이어짐" : ""}\n근무·생활 시간 블록 (실행 점수에 포함되지 않음)\n평가 날짜: ${date}`)}`,
        "CATEGORIES:TWELVEWEEK-TIMETABLE",
        "END:VEVENT",
      );
    }
  }
  for (const o of week.state.occurrences.filter(hasScheduledTime)) {
    const t = week.state.tactics.find((t) => t.id === o.tacticId);
    const start = calendarInstant(o.date, o.time);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${cycle.id}-${week.number}-${o.id}@twelve.local`,
      `DTSTAMP:${stamp(now)}`,
      `SEQUENCE:${week.version}`,
      `DTSTART:${stamp(start)}`,
      `DTEND:${stamp(new Date(+start + o.minutes * 60000))}`,
      `SUMMARY:${escape(t.title)}`,
      `DESCRIPTION:${escape(`${t.goalTitle}\n완료 조건: ${t.condition}\n평가 날짜: ${o.date}`)}`,
      "CATEGORIES:TWELVEWEEK-EXECUTION",
      "END:VEVENT",
    );
  }
  return lines.concat("END:VCALENDAR").map(fold).join("\r\n") + "\r\n";
}
