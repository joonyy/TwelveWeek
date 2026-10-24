import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { createPool } from "../server/db.js";
import { migrate } from "../server/migrate.js";
import { createApp } from "../server/app.js";
import { emptyPlan } from "../shared/domain.js";
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("Use a dedicated _test database");
const pool = createPool(url);
const app = createApp({
  pool,
  rateLimits: false,
  now: () => new Date("2026-10-07T12:00:00+09:00"),
});
before(async () => {
  await migrate(pool);
  await pool.query(
    "TRUNCATE changes,weeks,cycles,sessions,profiles RESTART IDENTITY CASCADE",
  );
});
after(async () => {
  await pool.end();
});
async function fixture(customize = () => {}) {
  const p = (
    await request(app)
      .post("/api/profiles")
      .send({ name: `전술 추가 ${randomUUID().slice(0, 8)}` })
  ).body;
  const token = (
    await request(app).post("/api/sessions").send({ profileId: p.id })
  ).body.token;
  const call = (method, path, body, target = app) => {
    let req = request(target)
      [method](`/api${path}`)
      .set("Authorization", `Bearer ${token}`);
    return body ? req.send(body) : req;
  };
  const plan = emptyPlan(3);
  plan.goals[0].title = "집중할 목표";
  Object.assign(plan.goals[0].tactics[0], {
    title: "기존 주간 실행",
    condition: "완료 결과 남기기",
    count: 3,
  });
  plan.goals[0].tactics.push({
    id: randomUUID(),
    title: "매일의 약속",
    condition: "한 줄 기록",
    kind: "daily",
    count: 1,
    weeks: [1, 2, 3],
  });
  plan.goals[1].title = "다른 주차의 목표";
  Object.assign(plan.goals[1].tactics[0], {
    title: "예정된 인터뷰",
    condition: "답변 기록 남기기",
    kind: "once",
    weeks: [2],
  });
  customize(plan);
  let cycle = (
    await call("post", "/cycles", {
      title: "전술 추가 검증",
      startDate: "2026-10-05",
      weekCount: 3,
      plan,
    }).expect(201)
  ).body;
  cycle = (
    await call("post", `/cycles/${cycle.id}/start`, {
      version: cycle.version,
    }).expect(200)
  ).body;
  const path = `/cycles/${cycle.id}`;
  const getCycle = async () => (await call("get", path)).body;
  const getWeek = async (number = 1) =>
    (await call("get", `${path}/weeks/${number}`)).body;
  const body = async (overrides = {}, number = 1) => ({
    cycleVersion: (await getCycle()).version,
    version: (await getWeek(number)).version,
    goalId: plan.goals[0].id,
    tactic: {
      id: randomUUID(),
      title: "새로운 행동",
      condition: "작은 결과 한 개 완성",
      kind: "weekly",
      count: 2,
      weeks: [1, 2],
    },
    date: number === 1 ? "2026-10-07" : "2026-10-14",
    time: "15:00",
    minutes: 120,
    ...overrides,
  });
  return { call, plan, path, getCycle, getWeek, body };
}

test("adding a scored tactic preserves all prior promises, completions, review and future placements", async () => {
  const f = await fixture();
  let w = await f.getWeek();
  const id = w.state.occurrences[0].id;
  w = (
    await f
      .call("put", `${f.path}/weeks/1/occurrences/${id}/schedule`, {
        version: w.version,
        date: w.today,
        time: "11:00",
        minutes: 60,
      })
      .expect(200)
  ).body;
  w = (
    await f
      .call("put", `${f.path}/weeks/1/occurrences/${id}/completion`, {
        version: w.version,
        completed: true,
      })
      .expect(200)
  ).body;
  w = (
    await f
      .call("put", `${f.path}/weeks/1/review`, {
        version: w.version,
        learned: "유지할 회고",
        next: "다음 약속",
        metrics: {},
      })
      .expect(200)
  ).body;
  let future = await f.getWeek(2);
  future = (
    await f
      .call("put", `${f.path}/weeks/2/occurrences/${id}/schedule`, {
        version: future.version,
        date: "2026-10-12",
        time: "16:00",
        minutes: 90,
      })
      .expect(200)
  ).body;
  const beforeCycle = await f.getCycle();
  const input = await f.body();
  const added = (
    await f.call("post", `${f.path}/weeks/1/tactics`, input).expect(201)
  ).body;
  assert.equal(added.week.state.tactics.length, w.state.tactics.length + 1);
  assert.equal(
    added.week.state.occurrences.length,
    w.state.occurrences.length + 2,
  );
  assert.deepEqual(
    added.week.state.tactics.slice(0, w.state.tactics.length),
    w.state.tactics,
  );
  assert.deepEqual(
    added.week.state.occurrences.slice(0, w.state.occurrences.length),
    w.state.occurrences,
  );
  assert.deepEqual(added.week.state.review, w.state.review);
  assert.equal(added.week.state.reviewSavedAt, w.state.reviewSavedAt);
  assert.equal(added.week.score.rows.length, 3);
  assert.equal(added.week.score.rows[0].weight, 100 / 3);
  assert.ok(Math.abs(added.week.score.score - 100 / 3 / 3) < 1e-9);
  assert.deepEqual(
    added.week.state.occurrences.find((o) => o.id === `${input.tactic.id}~0`),
    {
      id: `${input.tactic.id}~0`,
      tacticId: input.tactic.id,
      requiredDate: null,
      date: input.date,
      time: input.time,
      minutes: input.minutes,
      completed: false,
      executedAt: null,
    },
  );
  const next = await f.getWeek(2);
  assert.equal(next.state.tactics.length, future.state.tactics.length + 1);
  for (const o of future.state.occurrences)
    assert.deepEqual(
      next.state.occurrences.find((item) => item.id === o.id),
      o,
    );
  assert.equal(
    (await f.getWeek(3)).state.tactics.some((t) => t.id === input.tactic.id),
    false,
  );
  assert.deepEqual(
    added.cycle.plan.goals[0].tactics.slice(0, -1),
    beforeCycle.plan.goals[0].tactics,
  );
  await f.call("post", `${f.path}/weeks/1/tactics`, input).expect(409);
  await f
    .call("post", `${f.path}/weeks/1/tactics`, {
      ...input,
      version: added.week.version,
      cycleVersion: added.cycle.version,
    })
    .expect(409);
  assert.deepEqual((await f.getWeek()).state, added.week.state);
});

test("an existing off-week tactic can be adopted once without duplicating it in the plan", async () => {
  const f = await fixture(),
    before = await f.getWeek();
  const input = await f.body({
    goalId: f.plan.goals[1].id,
    tactic: undefined,
    sourceTacticId: f.plan.goals[1].tactics[0].id,
  });
  const added = (
    await f.call("post", `${f.path}/weeks/1/tactics`, input).expect(201)
  ).body;
  assert.equal(added.cycle.plan.goals[1].tactics.length, 1);
  assert.deepEqual(added.cycle.plan.goals[1].tactics[0].weeks, [1, 2]);
  assert.equal(
    added.week.state.tactics.length,
    before.state.tactics.length + 1,
  );
  assert.equal(
    added.week.state.occurrences.find(
      (o) => o.tacticId === input.sourceTacticId,
    ).date,
    input.date,
  );
  await f
    .call("post", `${f.path}/weeks/1/tactics`, {
      ...input,
      version: added.week.version,
      cycleVersion: added.cycle.version,
    })
    .expect(409);
});

test("daily additions keep all seven required dates and Sunday 01:00 belongs to Sunday's evaluation", async () => {
  const f = await fixture();
  const input = await f.body({
    tactic: {
      id: randomUUID(),
      title: "매일 읽기",
      condition: "한 문단 설명",
      kind: "daily",
      count: 1,
      weeks: [1],
    },
    date: "2026-10-11",
    time: "01:00",
  });
  const added = (
    await f.call("post", `${f.path}/weeks/1/tactics`, input).expect(201)
  ).body;
  const rows = added.week.state.occurrences.filter(
    (o) => o.tacticId === input.tactic.id,
  );
  assert.equal(rows.length, 7);
  assert.deepEqual(
    rows.map((o) => o.requiredDate),
    [
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
    ],
  );
  assert.equal(rows[6].date, "2026-10-11");
  assert.equal(rows[6].time, "01:00");
  await f
    .call("put", `${f.path}/weeks/1/occurrences/${rows[6].id}/schedule`, {
      version: added.week.version,
      date: "2026-10-10",
      time: "01:00",
      minutes: 120,
    })
    .expect(409);
});

test("future-week additions are generated once and never change the started week", async () => {
  const f = await fixture(),
    current = await f.getWeek();
  const input = await f.body({}, 2);
  const added = (
    await f.call("post", `${f.path}/weeks/2/tactics`, input).expect(201)
  ).body;
  assert.deepEqual((await f.getWeek()).state, current.state);
  assert.deepEqual(added.cycle.plan.goals[0].tactics.at(-1).weeks, [2]);
  assert.equal(
    added.week.state.occurrences.filter((o) => o.tacticId === input.tactic.id)
      .length,
    2,
  );
  assert.equal(
    added.week.state.occurrences.find((o) => o.tacticId === input.tactic.id)
      .date,
    "2026-10-14",
  );
});

test("ownership, stale data, invalid criteria and historical weeks reject additions without partial writes", async () => {
  const f = await fixture(),
    c = await f.getCycle(),
    w = await f.getWeek();
  const input = await f.body();
  await f
    .call("post", `${f.path}/weeks/1/tactics`, {
      ...input,
      tactic: { ...input.tactic, condition: " " },
    })
    .expect(400);
  await f
    .call("post", `${f.path}/weeks/1/tactics`, { ...input, date: "2026-10-12" })
    .expect(400);
  await f
    .call("post", `${f.path}/weeks/1/tactics`, {
      ...input,
      version: input.version + 1,
    })
    .expect(409);
  await f
    .call("post", `${f.path}/weeks/1/tactics`, {
      ...input,
      cycleVersion: input.cycleVersion + 1,
    })
    .expect(409);
  const other = await fixture();
  await other.call("post", `${f.path}/weeks/1/tactics`, input).expect(404);
  const past = createApp({
    pool,
    rateLimits: false,
    now: () => new Date("2026-11-01T12:00:00+09:00"),
  });
  await f.call("post", `${f.path}/weeks/1/tactics`, input, past).expect(409);
  assert.deepEqual(await f.getCycle(), c);
  assert.deepEqual((await f.getWeek()).state, w.state);
});

test("a future-week capacity failure rolls back the saved plan and current-week additions together", async () => {
  const f = await fixture((plan) => {
    for (let i = 0; i < 11; i++)
      plan.goals[0].tactics.push({
        id: randomUUID(),
        title: `미래 계획 ${i}`,
        condition: "실행 증거",
        kind: "weekly",
        count: 50,
        weeks: [2],
      });
  });
  const c = await f.getCycle(),
    weeks = await Promise.all([f.getWeek(1), f.getWeek(2), f.getWeek(3)]);
  const input = await f.body();
  input.tactic.count = 50;
  await f.call("post", `${f.path}/weeks/1/tactics`, input).expect(400);
  assert.deepEqual(await f.getCycle(), c);
  for (let i = 0; i < weeks.length; i++)
    assert.deepEqual(await f.getWeek(i + 1), weeks[i]);
});

test("an optional extra execution keeps minimum counts, scores and existing evidence intact", async () => {
  const f = await fixture();
  let w = await f.getWeek();
  const tactic = w.state.tactics[0],
    id = w.state.occurrences[0].id;
  w = (
    await f
      .call("put", `${f.path}/weeks/1/occurrences/${id}/schedule`, {
        version: w.version,
        date: w.today,
        time: "10:00",
        minutes: 60,
      })
      .expect(200)
  ).body;
  w = (
    await f
      .call("put", `${f.path}/weeks/1/occurrences/${id}/completion`, {
        version: w.version,
        completed: true,
      })
      .expect(200)
  ).body;
  w = (
    await f
      .call("put", `${f.path}/weeks/1/review`, {
        version: w.version,
        learned: "보존할 증거",
        next: "다음 결정",
        metrics: {},
      })
      .expect(200)
  ).body;
  const cycle = await f.getCycle(),
    future = await f.getWeek(2);
  const path = `${f.path}/weeks/1/tactics/${tactic.id}/occurrences`;
  const input = {
    version: w.version,
    confirmed: true,
    date: w.today,
    time: "15:00",
    minutes: 40,
  };
  const added = (await f.call("post", path, input).expect(201)).body;
  assert.equal(added.state.tactics.length, w.state.tactics.length);
  assert.equal(added.state.tactics[0].plannedCount, 3);
  assert.deepEqual(added.state.tacticCounts, w.state.tacticCounts);
  assert.deepEqual(added.state.occurrences.slice(0, -1), w.state.occurrences);
  assert.deepEqual(added.state.review, w.state.review);
  assert.equal(added.state.reviewSavedAt, w.state.reviewSavedAt);
  assert.deepEqual(added.state.occurrences.at(-1), {
    id: added.state.occurrences.at(-1).id,
    tacticId: tactic.id,
    extra: true,
    requiredDate: null,
    date: w.today,
    time: "15:00",
    minutes: 40,
    completed: false,
    executedAt: null,
  });
  assert.equal(added.score.rows[0].weight, 50);
  assert.match(added.state.occurrences.at(-1).id, /~extra-/);
  assert.equal(added.score.rows[0].rate, 1 / 3);
  assert.equal(added.score.score, w.score.score);
  assert.equal(
    added.daily.find((d) => d.date === w.today).planned,
    w.daily.find((d) => d.date === w.today).planned,
  );
  assert.deepEqual(await f.getCycle(), cycle);
  assert.deepEqual(await f.getWeek(2), future);
  await f.call("post", path, input).expect(409);
  assert.deepEqual(await f.getWeek(), added);
  const audit = (
    await pool.query(
      "SELECT detail FROM changes WHERE cycle_id=$1 AND kind='tactic.occurrence_added'",
      [cycle.id],
    )
  ).rows[0].detail;
  assert.equal(audit.fromCount, 3);
  assert.equal(audit.toCount, 3);
  assert.equal(audit.extra, true);
  const completed = (
    await f
      .call(
        "put",
        `${f.path}/weeks/1/occurrences/${added.state.occurrences.at(-1).id}/completion`,
        {
          version: added.version,
          completed: true,
        },
      )
      .expect(200)
  ).body;
  assert.equal(completed.score.rows[0].rate, 2 / 3);
  assert.equal(completed.daily.find((d) => d.date === w.today).extraDone, 1);
  assert.equal(
    completed.daily.find((d) => d.date === w.today).score,
    w.daily.find((d) => d.date === w.today).score,
  );
});

test("a once tactic can gain a week-local repetition that survives future timetable and plan edits", async () => {
  const f = await fixture(),
    cycle = await f.getCycle(),
    current = await f.getWeek();
  let w = await f.getWeek(2);
  const tactic = w.state.tactics.find((t) => t.kind === "once");
  const added = (
    await f
      .call("post", `${f.path}/weeks/2/tactics/${tactic.id}/occurrences`, {
        version: w.version,
        confirmed: true,
        date: "2026-10-14",
        time: "01:00",
        minutes: 30,
      })
      .expect(201)
  ).body;
  assert.equal(
    added.state.tactics.find((t) => t.id === tactic.id).plannedCount,
    1,
  );
  assert.deepEqual(await f.getCycle(), cycle);
  const plan = structuredClone(cycle.plan);
  plan.responsibility = "시간표나 다른 계획을 수정해도 추가한 약속 유지";
  await f
    .call("put", f.path, {
      version: cycle.version,
      title: cycle.title,
      startDate: cycle.start_date,
      weekCount: cycle.week_count,
      plan,
    })
    .expect(200);
  w = await f.getWeek(2);
  assert.equal(w.state.tactics.find((t) => t.id === tactic.id).plannedCount, 1);
  assert.deepEqual(w.state.occurrences.at(-1), added.state.occurrences.at(-1));
  assert.deepEqual(await f.getWeek(), current);
  assert.equal((await f.getWeek(3)).state.tacticCounts, undefined);
});

test("extra occurrences require confirmation and reject daily substitutions, past dates, foreign owners and limits atomically", async () => {
  const f = await fixture(),
    before = await f.getWeek(),
    cycle = await f.getCycle();
  const tactic = before.state.tactics[0],
    daily = before.state.tactics.find((t) => t.kind === "daily");
  const path = `${f.path}/weeks/1/tactics/${tactic.id}/occurrences`;
  const input = {
    version: before.version,
    confirmed: true,
    date: before.today,
    time: "15:00",
    minutes: 30,
  };
  await f.call("post", path, { ...input, confirmed: false }).expect(400);
  await f.call("post", path, { ...input, date: "2026-10-06" }).expect(409);
  await f.call("post", path, { ...input, date: "2026-10-12" }).expect(400);
  await f
    .call("post", `${f.path}/weeks/1/tactics/${daily.id}/occurrences`, input)
    .expect(409);
  const other = await fixture();
  await other.call("post", path, input).expect(404);
  const past = createApp({
    pool,
    rateLimits: false,
    now: () => new Date("2026-10-12T12:00:00+09:00"),
  });
  await f.call("post", path, input, past).expect(409);
  assert.deepEqual(await f.getWeek(), before);
  assert.deepEqual(await f.getCycle(), cycle);
  const capped = await fixture((plan) => {
    plan.goals[0].tactics[0].count = 50;
  });
  const w = await capped.getWeek();
  await capped
    .call(
      "post",
      `${capped.path}/weeks/1/tactics/${w.state.tactics[0].id}/occurrences`,
      {
        ...input,
        version: w.version,
      },
    )
    .expect(400);
  assert.deepEqual(await capped.getWeek(), w);
});
