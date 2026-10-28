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
});
after(async () => {
  await pool.end();
});
async function fixture() {
  const p = (
    await request(app)
      .post("/api/profiles")
      .send({
        password: "test-password",
        name: `배치 편집 ${randomUUID().slice(0, 8)}`,
      })
      .expect(201)
  ).body;
  const { token } = (
    await request(app)
      .post("/api/sessions")
      .send({ password: "test-password", profileId: p.id })
      .expect(200)
  ).body;
  const call = (method, path, body, target = app) => {
    const req = request(target)
      [method](`/api${path}`)
      .set("Authorization", `Bearer ${token}`);
    return body ? req.send(body) : req;
  };
  const plan = emptyPlan(2),
    g = plan.goals[0];
  g.title = "실행과 평가 유지";
  Object.assign(g.tactics[0], {
    title: "산책",
    condition: "2km",
    count: 3,
    weeks: [1, 2],
  });
  g.tactics.push({
    id: randomUUID(),
    title: "매일 기록",
    condition: "한 줄",
    kind: "daily",
    count: 1,
    weeks: [1, 2],
  });
  let c = (
    await call("post", "/cycles", {
      title: "배치 검증",
      startDate: "2026-10-05",
      weekCount: 2,
      plan,
    }).expect(201)
  ).body;
  c = (
    await call("post", `/cycles/${c.id}/start`, { version: c.version }).expect(
      200,
    )
  ).body;
  const path = `/cycles/${c.id}`,
    getWeek = async (n = 1) =>
      (await call("get", `${path}/weeks/${n}`).expect(200)).body;
  return { call, c, path, getWeek };
}
test("unplace, restore and move preserve evaluation promises, other records, reviews and the original plan", async () => {
  const f = await fixture();
  let w = await f.getWeek();
  const id = w.state.occurrences[0].id,
    sibling = w.state.occurrences[1].id;
  const schedule = (id, body) =>
    f.call("put", `${f.path}/weeks/1/occurrences/${id}/schedule`, {
      version: w.version,
      ...body,
    });
  w = (
    await schedule(id, { date: w.today, time: "10:00", minutes: 60 }).expect(
      200,
    )
  ).body;
  w = (
    await schedule(sibling, {
      date: w.today,
      time: "11:00",
      minutes: 30,
    }).expect(200)
  ).body;
  w = (
    await f
      .call("put", `${f.path}/weeks/1/occurrences/${sibling}/completion`, {
        version: w.version,
        completed: true,
      })
      .expect(200)
  ).body;
  w = (
    await f
      .call("put", `${f.path}/weeks/1/review`, {
        version: w.version,
        learned: "보존할 회고",
        next: "유지할 판단",
        metrics: {},
      })
      .expect(200)
  ).body;
  const before = structuredClone(w),
    future = await f.getWeek(2);
  w = (
    await schedule(id, {
      date: w.today,
      time: "10:00",
      minutes: 60,
      timePlaced: false,
    }).expect(200)
  ).body;
  assert.deepEqual(w.score, before.score);
  assert.deepEqual(w.daily, before.daily);
  assert.deepEqual(w.state.tactics, before.state.tactics);
  assert.deepEqual(w.state.review, before.state.review);
  assert.equal(w.state.reviewSavedAt, before.state.reviewSavedAt);
  assert.deepEqual(
    w.state.occurrences.slice(1),
    before.state.occurrences.slice(1),
  );
  assert.deepEqual(w.state.occurrences[0], {
    ...before.state.occurrences[0],
    timePlaced: false,
  });
  const exported = await f
    .call("get", `${f.path}/weeks/1/calendar.ics`)
    .expect(200);
  assert.equal(
    exported.text.includes(`UID:${f.c.id}-1-${id}@twelve.local`),
    false,
  );
  await schedule(id, {
    date: null,
    time: "10:00",
    minutes: 60,
    timePlaced: false,
  }).expect(409);
  await schedule(id, {
    date: w.today,
    time: "10:00",
    minutes: 60,
    version: before.version,
  }).expect(409);
  w = (
    await schedule(id, {
      date: w.today,
      time: "10:00",
      minutes: 60,
      timePlaced: true,
    }).expect(200)
  ).body;
  assert.deepEqual(w.state, before.state);
  w = (
    await schedule(id, { date: w.today, time: "12:30", minutes: 60 }).expect(
      200,
    )
  ).body;
  assert.equal(w.state.occurrences[0].time, "12:30");
  assert.deepEqual(w.daily, before.daily);
  assert.deepEqual((await f.call("get", f.path)).body, f.c);
  assert.deepEqual(await f.getWeek(2), future);
  await schedule(sibling, {
    date: w.today,
    time: "11:00",
    minutes: 30,
    timePlaced: false,
  }).expect(409);
  const other = await fixture();
  await other
    .call("put", `${f.path}/weeks/1/occurrences/${id}/schedule`, {
      version: w.version,
      date: w.today,
      time: "12:30",
      minutes: 60,
      timePlaced: false,
    })
    .expect(404);
});
test("daily time removal keeps its required day, cannot substitute dates, and future untimed placements survive plan saves", async () => {
  const f = await fixture();
  let w = await f.getWeek();
  const daily = w.state.occurrences.find((o) => o.requiredDate === w.today);
  const path = `${f.path}/weeks/1/occurrences/${daily.id}/schedule`;
  const body = {
    version: w.version,
    date: daily.date,
    time: daily.time,
    minutes: daily.minutes,
    timePlaced: false,
  };
  const changed = (await f.call("put", path, body).expect(200)).body;
  assert.deepEqual(changed.daily, w.daily);
  assert.equal(
    changed.state.occurrences.find((o) => o.id === daily.id).requiredDate,
    w.today,
  );
  await f
    .call("put", path, {
      ...body,
      version: changed.version,
      date: "2026-10-08",
    })
    .expect(409);
  const past = createApp({
    pool,
    rateLimits: false,
    now: () => new Date("2026-10-12T12:00:00+09:00"),
  });
  await f
    .call("put", path, { ...body, version: changed.version }, past)
    .expect(409);
  w = await f.getWeek(2);
  const o = w.state.occurrences[0];
  w = (
    await f
      .call("put", `${f.path}/weeks/2/occurrences/${o.id}/schedule`, {
        version: w.version,
        date: "2026-10-14",
        time: "15:00",
        minutes: 60,
      })
      .expect(200)
  ).body;
  w = (
    await f
      .call("put", `${f.path}/weeks/2/occurrences/${o.id}/schedule`, {
        version: w.version,
        date: "2026-10-14",
        time: "15:00",
        minutes: 60,
        timePlaced: false,
      })
      .expect(200)
  ).body;
  await f
    .call("put", f.path, {
      version: f.c.version,
      title: f.c.title,
      startDate: f.c.start_date,
      weekCount: 2,
      plan: f.c.plan,
    })
    .expect(200);
  assert.deepEqual(
    (await f.getWeek(2)).state.occurrences[0],
    w.state.occurrences[0],
  );
  assert.deepEqual((await f.getWeek()).state, changed.state);
});
