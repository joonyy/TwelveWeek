import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyPlan } from "../shared/domain.js";
import { modelWeekFor, withWeekModel } from "../shared/planning.js";
import {
  templateFromDay,
  workDuration,
  instantiateDayTemplate,
  templateReplacementCandidates,
  planWithDayTemplate,
  templateConflicts,
} from "../shared/day-templates.js";
import { planSchema } from "../server/schema.js";
const block = (title, time, minutes = 60, kind = "fixed", day = 0) => ({
  id: crypto.randomUUID(),
  day,
  time,
  minutes,
  kind,
  title,
});
function template() {
  const work = block("맥날", "19:00", 360),
    before = block("산책", "18:30", 30, "breakout"),
    after = block("러닝", "01:00", 30, "strategy"),
    meeting = block("고정 약속", "12:00");
  const t = templateFromDay([work, before, after, meeting], 0, "근무 있는 날");
  t.workBlockId = t.blocks[0].id;
  Object.assign(t.blocks[1], { anchor: "work-start", offset: -30 });
  Object.assign(t.blocks[2], { anchor: "work-end", offset: 0 });
  return t;
}
const options = { startDate: "2026-10-05", weekCount: 2, today: "2026-10-07" };
test("copying one model day uses independent IDs, copies no executions and validates old and new plans", () => {
  const plan = emptyPlan(2),
    before = structuredClone(plan);
  plan.modelWeek = [
    block("수면", "03:00", 420),
    block("다른 날", "12:00", 60, "fixed", 1),
  ];
  const t = templateFromDay(plan.modelWeek, 0, "쉬는 날");
  assert.equal(t.blocks.length, 1);
  assert.notEqual(t.blocks[0].id, plan.modelWeek[0].id);
  assert.equal(t.blocks[0].day, undefined);
  assert.deepEqual(planSchema.parse(before), before);
  Object.assign(plan, { dayTemplates: [t], modelWeekMode: "day" });
  assert.deepEqual(planSchema.parse(plan), plan);
  t.blocks[0].title = "변경";
  assert.equal(plan.modelWeek[0].title, "수면");
});
test("work-linked activities cross 04:00 and Sunday boundaries while fixed appointments retain their clocks", () => {
  const t = template(),
    copy = structuredClone(t);
  const result = instantiateDayTemplate(t, "2026-10-11", {
    ...options,
    workTime: "23:00",
    workMinutes: 480,
  });
  assert.deepEqual(
    result.blocks.map((x) => [
      x.date,
      x.week,
      x.block.day,
      x.block.time,
      x.block.minutes,
    ]),
    [
      ["2026-10-11", 1, 6, "23:00", 480],
      ["2026-10-11", 1, 6, "22:30", 30],
      ["2026-10-12", 2, 0, "07:00", 30],
      ["2026-10-11", 1, 6, "12:00", 60],
    ],
  );
  assert.deepEqual(t, copy);
  assert.equal(workDuration("23:00", "07:00"), 480);
  assert.equal(workDuration("19:00", "01:00"), 360);
  const previous = instantiateDayTemplate(t, "2026-10-12", {
    ...options,
    workTime: "04:00",
    workMinutes: 480,
  });
  assert.equal(previous.blocks[1].date, "2026-10-11");
  assert.equal(previous.blocks[1].block.time, "03:30");
});
test("replacement changes only selected model blocks and affected weeks; reapplied spill blocks stay identifiable", () => {
  const plan = emptyPlan(2);
  plan.modelWeek = [
    block("월 근무", "10:00"),
    block("일 근무", "15:00", 480, "fixed", 6),
  ];
  const original = structuredClone(plan),
    t = template();
  plan.dayTemplates = [t];
  const generated = instantiateDayTemplate(t, "2026-10-11", {
    ...options,
    workTime: "23:00",
    workMinutes: 480,
  });
  const candidates = templateReplacementCandidates(
    plan,
    "2026-10-11",
    options.startDate,
    2,
    options.today,
  );
  const changed = planWithDayTemplate(
    plan,
    generated.blocks,
    candidates.map((c) => c.key),
  );
  assert.deepEqual(plan.modelWeek, original.modelWeek);
  assert.deepEqual(changed.modelWeek, original.modelWeek);
  assert.deepEqual(changed.goals, plan.goals);
  assert.equal(
    modelWeekFor(changed, 1).some((b) => b.title === "일 근무"),
    false,
  );
  assert.equal(modelWeekFor(changed, 2).find((b) => b.title === "러닝").day, 0);
  assert.equal(
    modelWeekFor(changed, 2).find((b) => b.title === "월 근무").id,
    original.modelWeek[0].id,
  );
  assert.deepEqual(planSchema.parse(changed), changed);
  const again = templateReplacementCandidates(
    changed,
    "2026-10-11",
    options.startDate,
    2,
    options.today,
  );
  assert.equal(
    again.some((c) => c.week === 2 && c.block.title === "러닝"),
    true,
  );
  assert.equal(
    again.some((c) => c.week === 2 && c.block.title === "월 근무"),
    false,
  );
});
test("conflicts cover existing work, previous overnight carry, new blocks and completed executions without self collisions", () => {
  const plan = emptyPlan(2);
  plan.modelWeek = [block("이전 주 야간", "03:00", 420, "fixed", 6)];
  const t = templateFromDay(
    [block("추가 활동", "08:00"), block("동시 활동", "08:30")],
    0,
    "휴무",
  );
  const generated = instantiateDayTemplate(t, "2026-10-12", options);
  const proposed = planWithDayTemplate(plan, generated.blocks, []);
  const conflicts = templateConflicts(
    proposed,
    generated.blocks,
    [
      {
        id: "done",
        date: "2026-10-12",
        time: "08:00",
        minutes: 30,
        timePlaced: true,
        completed: true,
        title: "완료한 전술",
      },
    ],
    options.startDate,
    2,
  );
  assert.ok(conflicts.some((c) => c.other === "이전 주 야간"));
  assert.ok(conflicts.some((c) => c.other === "완료한 전술"));
  assert.ok(conflicts.some((c) => c.other === "동시 활동"));
  assert.equal(
    conflicts.some((c) => c.title === c.other),
    false,
  );
  const firstMonday = instantiateDayTemplate(t, "2026-10-05", {
    ...options,
    today: undefined,
  });
  const firstPlan = planWithDayTemplate(plan, firstMonday.blocks, []);
  assert.ok(
    templateConflicts(
      firstPlan,
      firstMonday.blocks,
      [],
      options.startDate,
      2,
    ).some((c) => c.other === "이전 주 야간"),
  );
});
test("period overflow and past dates are explicit omissions, invalid shifts and corrupt anchors are rejected", () => {
  const t = template();
  const result = instantiateDayTemplate(t, "2026-10-18", {
    ...options,
    workTime: "23:00",
    workMinutes: 480,
  });
  assert.equal(result.issues.length, 1);
  assert.equal(result.blocks.length, 3);
  assert.match(result.issues[0].message, /追加|추가하지/);
  assert.equal(
    instantiateDayTemplate(t, "2026-10-06", options).blocks.length,
    0,
  );
  assert.equal(
    instantiateDayTemplate(t, "2026-10-11", { ...options, workMinutes: 0 })
      .invalid,
    true,
  );
  for (const mutate of [
    (t) => {
      t.workBlockId = crypto.randomUUID();
    },
    (t) => {
      t.blocks[0].anchor = "work-end";
      t.blocks[0].offset = 0;
    },
    (t) => {
      t.blocks[1].offset = 2000;
    },
    (t) => {
      t.blocks.push(t.blocks[0]);
    },
  ]) {
    const p = emptyPlan(2),
      bad = template();
    mutate(bad);
    p.dayTemplates = [bad];
    assert.equal(planSchema.safeParse(p).success, false);
  }
});
test("an empty day can clear only selected reference blocks and template deletion never changes applied copies", () => {
  const plan = emptyPlan(2);
  plan.modelWeek = [
    block("목 근무", "10:00", 60, "fixed", 3),
    block("월 근무", "10:00"),
  ];
  const key = templateReplacementCandidates(
    plan,
    "2026-10-08",
    options.startDate,
    2,
    options.today,
  )[0].key;
  const changed = planWithDayTemplate(plan, [], [key]);
  assert.equal(modelWeekFor(changed, 1).length, 1);
  assert.equal(plan.modelWeek.length, 2);
  const t = template(),
    generated = instantiateDayTemplate(t, "2026-10-08", options);
  const applied = planWithDayTemplate(plan, generated.blocks, []);
  applied.dayTemplates = [];
  assert.equal(
    modelWeekFor(applied, 1).some((b) => b.templateOrigin?.templateId === t.id),
    true,
  );
});

test("promoting a dated template result to the default removes date provenance only from the repeating default", () => {
  const plan = emptyPlan(2),
    t = template();
  const generated = instantiateDayTemplate(t, "2026-10-08", options);
  const applied = planWithDayTemplate(plan, generated.blocks, []);
  const promoted = withWeekModel(applied, 1, modelWeekFor(applied, 1), {
    applyToDefault: true,
  });
  assert.ok(
    promoted.weeklyModelWeeks[0].blocks.every(
      (b) => b.templateOrigin?.date === "2026-10-08",
    ),
  );
  assert.ok(promoted.modelWeek.every((b) => !b.templateOrigin));
  assert.ok(
    templateReplacementCandidates(
      promoted,
      "2026-10-08",
      options.startDate,
      2,
      options.today,
    ).every((c) => c.week === 1),
  );
});
