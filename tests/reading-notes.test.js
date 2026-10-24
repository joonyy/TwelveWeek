import { test } from "node:test";
import assert from "node:assert/strict";
import { readingRecords, readingMarkdown } from "../shared/reading-notes.js";
import { emptyPlan, prepareWeek } from "../shared/domain.js";

test("reading records group by book, retain evaluation dates and export drafts without changing the source", () => {
  const weeks = [
    {
      number: 1,
      state: {
        tactics: [{ id: "read", goalTitle: "기록 활용" }],
        occurrences: [
          {
            id: "read~0",
            tacticId: "read",
            date: "2026-10-07",
            completed: true,
            readingRecord: {
              book: "책 [A]",
              chapter: "1장",
              thought: "기억보다 재사용이 중요하다.\n내 사례를 연결하자.",
            },
          },
          {
            id: "read~1",
            tacticId: "read",
            date: null,
            completed: false,
            readingRecord: {
              book: "책 [A]",
              chapter: "2장",
              thought: "다음 질문",
            },
          },
        ],
      },
    },
  ];
  const before = structuredClone(weeks);
  assert.equal(readingRecords(weeks).length, 2);
  const md = readingMarkdown("나의 기록", weeks);
  assert.equal(md.match(/^## /gm).length, 1);
  assert.ok(md.includes("## 책 \\[A\\]"));
  assert.ok(md.includes("2026-10-07 · 실행 완료"));
  assert.ok(md.includes("날짜 미정 · 기록 초안"));
  assert.ok(md.includes("> 내 사례를 연결하자."));
  assert.deepEqual(weeks, before);
});

test("future regeneration retains reading metadata and existing record text", () => {
  const plan = emptyPlan(2);
  plan.goals[0].title = "독서";
  Object.assign(plan.goals[0].tactics[0], {
    title: "독서",
    condition: "한 줄",
    readingBook: "세컨드 브레인",
    weeks: [1, 2],
  });
  const week = prepareWeek(plan, "2026-10-05", 2);
  const record = {
    book: "세컨드 브레인",
    chapter: "1장",
    thought: "한 줄 생각",
  };
  week.occurrences[0].readingRecord = record;
  const next = prepareWeek(plan, "2026-10-05", 2, week);
  assert.equal(next.tactics[0].readingBook, "세컨드 브레인");
  assert.deepEqual(next.occurrences[0].readingRecord, record);
  assert.notEqual(next.occurrences[0].readingRecord, record);
});
