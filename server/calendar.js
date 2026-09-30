import { calendarInstant } from "../shared/domain.js";
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
  ];
  for (const o of week.state.occurrences.filter((o) => o.date)) {
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
      "END:VEVENT",
    );
  }
  return lines.concat("END:VCALENDAR").map(fold).join("\r\n") + "\r\n";
}
