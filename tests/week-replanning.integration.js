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
let instant = new Date("2026-10-07T12:00:00+09:00");
const app = createApp({ pool, rateLimits: false, now: () => instant });
before(async () => {
  await migrate(pool);
  await pool.query(
    "TRUNCATE changes,weeks,cycles,sessions,profiles RESTART IDENTITY CASCADE",
  );
});
after(async () => pool.end());

async function fixture() {
  instant = new Date("2026-10-07T12:00:00+09:00");
  const profile = (
    await request(app)
      .post("/api/profiles")
      .send({ name: randomUUID().slice(0, 20), password: "test-password" })
  ).body;
  const token = (
    await request(app)
      .post("/api/sessions")
      .send({ profileId: profile.id, password: "test-password" })
  ).body.token;
  const call = (method, path, body) => {
    const r = request(app)
      [method](`/api${path}`)
      .set("Authorization", `Bearer ${token}`);
    return body ? r.send(body) : r;
  };
  const plan = emptyPlan(3);
  plan.goals[0].title = "현재 목표";
  Object.assign(plan.goals[0].tactics[0], {
    title: "기존 전술",
    condition: "완료 조건",
    count: 3,
    weeks: [1, 2, 3],
  });
  let cycle = (
    await call("post", "/cycles", {
      title: "재정립 검증",
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
  const path = `/cycles/${cycle.id}/weeks/1`;
  const get = async () => (await call("get", path).expect(200)).body;
  const payload = async (extra = {}) => ({
    version: (await get()).version,
    cycleVersion: cycle.version,
    effectiveDate: "2026-10-07",
    reason: "work",
    note: "새 학원 근무",
    keepIds: [],
    additions: [
      {
        goalId: plan.goals[0].id,
        title: "남은 기록",
        condition: "한 줄",
        kind: "daily",
        count: 1,
      },
    ],
    confirmed: true,
    ...extra,
  });
  return { call, cycle, plan, path, get, payload };
}

test("atomic replan preserves original records, future weeks and cycle plan, and survives reload with independent scores", async () => {
  const f = await fixture();
  let week = await f.get();
  const first = week.state.occurrences[0];
  week = (
    await f
      .call("put", `${f.path}/occurrences/${first.id}/schedule`, {
        version: week.version,
        date: "2026-10-05",
        time: "10:00",
        minutes: 60,
      })
      .expect(200)
  ).body;
  week = (
    await f
      .call("put", `${f.path}/occurrences/${first.id}/completion`, {
        version: week.version,
        completed: true,
        executedAt: "2026-10-05T10:30:00+09:00",
      })
      .expect(200)
  ).body;
  const futurePath = `/cycles/${f.cycle.id}/weeks/2`;
  const future = (await f.call("get", futurePath)).body;
  const response = await f
    .call("post", `${f.path}/replan`, await f.payload())
    .expect(201);
  const next = response.body;
  assert.deepEqual(next.state.replans[0].snapshot, week.state);
  assert.ok(Math.abs(next.state.replans[0].score.score - 100 / 3) < 1e-9);
  assert.equal(next.score.score, 0);
  assert.equal(next.state.occurrences.length, 5);
  assert.equal(next.daily[0].score, 100);
  assert.deepEqual((await f.get()).state, next.state);
  assert.deepEqual((await f.call("get", futurePath)).body, future);
  assert.deepEqual(
    (await f.call("get", `/cycles/${f.cycle.id}`)).body.plan,
    f.cycle.plan,
  );
  const events = await pool.query(
    "SELECT kind FROM changes WHERE cycle_id=$1 AND kind='week.replanned'",
    [f.cycle.id],
  );
  assert.equal(events.rowCount, 1);
  const saved = next.state.occurrences[0];
  let current = (
    await f
      .call("put", `${f.path}/occurrences/${saved.id}/schedule`, {
        version: next.version,
        date: "2026-10-07",
        time: "12:00",
        minutes: 30,
      })
      .expect(200)
  ).body;
  current = (
    await f
      .call("put", `${f.path}/occurrences/${saved.id}/completion`, {
        version: current.version,
        completed: true,
      })
      .expect(200)
  ).body;
  assert.equal(current.score.score, 20);
  assert.deepEqual(current.state.replans[0], next.state.replans[0]);
  await f
    .call("put", `${f.path}/occurrences/${first.id}/completion`, {
      version: current.version,
      completed: false,
    })
    .expect(404);
});

test("ownership, stale versions, evaluation-day rollover and noncurrent weeks are rejected without changing history", async () => {
  const f = await fixture();
  const other = await fixture();
  const body = await f.payload();
  await other.call("post", `${f.path}/replan`, body).expect(404);
  await f
    .call("post", `${f.path}/replan`, { ...body, version: 999 })
    .expect(409);
  await f
    .call("post", `${f.path}/replan`, { ...body, cycleVersion: 999 })
    .expect(409);
  await f
    .call("post", `${f.path}/replan`, { ...body, keepIds: ["unknown"] })
    .expect(400);
  await f.call("post", `${f.path}/replan`, { ...body, note: " " }).expect(400);
  await f
    .call("post", `/cycles/${f.cycle.id}/weeks/2/replan`, body)
    .expect(409);
  instant = new Date("2026-10-08T03:59:00+09:00");
  await f.call("post", `${f.path}/replan`, body).expect(201);
  instant = new Date("2026-10-08T04:00:00+09:00");
  await f.call("post", `${f.path}/replan`, await f.payload()).expect(409);
  instant = new Date("2026-10-12T12:00:00+09:00");
  await f
    .call(
      "post",
      `${f.path}/replan`,
      await f.payload({ effectiveDate: "2026-10-12" }),
    )
    .expect(409);
  assert.equal((await f.get()).state.replans.length, 1);
});

test("replanned actions cannot be backdated or reuse archived tactic identities, and later daily additions only create remaining days", async () => {
  const f = await fixture();
  let week = (
    await f
      .call(
        "post",
        `${f.path}/replan`,
        await f.payload({
          additions: [
            {
              goalId: f.plan.goals[0].id,
              title: "새로운 주간 약속",
              condition: "결과",
              kind: "weekly",
              count: 1,
            },
          ],
        }),
      )
      .expect(201)
  ).body;
  await f
    .call(
      "put",
      `${f.path}/occurrences/${week.state.occurrences[0].id}/schedule`,
      { version: week.version, date: "2026-10-06", time: "12:00", minutes: 30 },
    )
    .expect(409);
  const base = {
    version: week.version,
    cycleVersion: f.cycle.version,
    goalId: f.plan.goals[0].id,
    date: week.today,
    time: "14:00",
    minutes: 30,
  };
  await f
    .call("post", `${f.path}/tactics`, {
      ...base,
      sourceTacticId: f.plan.goals[0].tactics[0].id,
    })
    .expect(409);
  assert.deepEqual((await f.get()).state, week.state);
  const tactic = {
    id: randomUUID(),
    title: "이후 추가한 매일 약속",
    condition: "한 줄",
    kind: "daily",
    count: 1,
    weeks: [],
  };
  week = (
    await f.call("post", `${f.path}/tactics`, { ...base, tactic }).expect(201)
  ).body.week;
  const added = week.state.occurrences.filter((o) => o.tacticId === tactic.id);
  assert.equal(added.length, 5);
  assert.equal(
    week.state.tactics.find((t) => t.id === tactic.id).plannedCount,
    5,
  );
  assert.ok(added.every((o) => o.requiredDate >= "2026-10-07"));
});

test("archived week-local tactic IDs cannot be reused to overwrite their reading or execution identity", async () => {
  const f = await fixture();
  let week = (
    await f.call("post", `${f.path}/replan`, await f.payload()).expect(201)
  ).body;
  const archivedId = week.state.tactics[0].id;
  week = (
    await f
      .call("post", `${f.path}/replan`, await f.payload({ additions: [] }))
      .expect(201)
  ).body;
  await f
    .call("post", `${f.path}/tactics`, {
      version: week.version,
      cycleVersion: f.cycle.version,
      goalId: f.plan.goals[0].id,
      date: "2026-10-07",
      time: "13:00",
      minutes: 30,
      tactic: {
        id: archivedId,
        title: "같은 ID 재사용",
        condition: "기록",
        kind: "weekly",
        count: 1,
        weeks: [],
      },
    })
    .expect(409);
  assert.deepEqual((await f.get()).state, week.state);
});
