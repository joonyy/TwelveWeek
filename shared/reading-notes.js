export function readingRecords(weeks) {
  return weeks.flatMap((week) =>
    week.state.occurrences
      .filter((o) => o.readingRecord)
      .map((o) => {
        const tactic = week.state.tactics.find((t) => t.id === o.tacticId);
        return {
          ...o.readingRecord,
          occurrenceId: o.id,
          week: week.number,
          date: o.date,
          completed: o.completed,
          goalTitle: tactic?.goalTitle ?? "",
        };
      }),
  );
}

const heading = (text) =>
  text.replace(/[\r\n]+/g, " ").replace(/([\\`*_[\]<>#])/g, "\\$1");
export function readingMarkdown(title, weeks) {
  const groups = new Map();
  for (const record of readingRecords(weeks)) {
    if (!groups.has(record.book)) groups.set(record.book, []);
    groups.get(record.book).push(record);
  }
  const lines = [
    `# ${heading(title)} · 독서 기록`,
    "",
    "TwelveWeek에서 남긴 독서 기록입니다. 평가 날짜는 04:00 경계를 따릅니다.",
    "",
  ];
  for (const [book, records] of groups) {
    lines.push(`## ${heading(book)}`, "");
    for (const r of records)
      lines.push(
        `### ${heading(r.chapter)}`,
        "",
        `- ${r.week}주차 · ${r.date ?? "날짜 미정"} · ${r.completed ? "실행 완료" : "기록 초안"}`,
        ...(r.goalTitle ? [`- 목표: ${heading(r.goalTitle)}`] : []),
        "",
        ...r.thought
          .replace(/\r\n?/g, "\n")
          .split("\n")
          .map((line) => `> ${line}`),
        "",
      );
  }
  if (!groups.size) lines.push("아직 저장된 독서 기록이 없습니다.", "");
  return lines.join("\n");
}
