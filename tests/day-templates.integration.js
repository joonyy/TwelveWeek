import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createPool } from "../server/db.js";
import { migrate } from "../server/migrate.js";
import { createApp } from "../server/app.js";
import { emptyPlan } from "../shared/domain.js";
import {
  templateFromDay,
  instantiateDayTemplate,
  planWithDayTemplate,
} from "../shared/day-templates.js";
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("Use a dedicated test database");
const pool = createPool(url),
  app = createApp({
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
async function client() {
  const profile = (
    await request(app)
      .post("/api/profiles")
      .send({
        name: `하루원형 ${crypto.randomUUID().slice(0, 8)}`,
        password: "test-password",
      })
      .expect(201)
  ).body;
  const { token } = (
    await request(app)
      .post("/api/sessions")
      .send({ profileId: profile.id, password: "test-password" })
      .expect(200)
  ).body;
  return (method, path, body) => {
    const r = request(app)
      [method](`/api${path}`)
      .set("Authorization", `Bearer ${token}`);
    return body ? r.send(body) : r;
  };
}
test("day templates round-trip per owner and atomically update two weeks without changing completion, reading or review records", async () => {
  const call = await client(),
    other = await client(),
    plan = emptyPlan(2);
  plan.goals[0].title = "기록 유지";
  Object.assign(plan.goals[0].tactics[0], {
    title: "독서",
    condition: "한 줄",
    readingBook: "테스트 책",
    count: 2,
    weeks: [1, 2],
  });
  const shift = {
    id: crypto.randomUUID(),
    day: 6,
    time: "23:00",
    minutes: 480,
    kind: "fixed",
    title: "야간 근무",
  };
  plan.modelWeek = [shift];
  let c = (
    await call("post", "/cycles", {
      title: "하루 유형 검증",
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
    getWeek = async (n) =>
      (await call("get", `${path}/weeks/${n}`).expect(200)).body;
  let w = await getWeek(1),
    o = w.state.occurrences[0];
  w = (
    await call("put", `${path}/weeks/1/occurrences/${o.id}/schedule`, {
      version: w.version,
      date: "2026-10-07",
      time: "10:00",
      minutes: 60,
    }).expect(200)
  ).body;
  w = (
    await call("put", `${path}/weeks/1/occurrences/${o.id}/completion`, {
      version: w.version,
      completed: true,
      readingRecord: {
        book: "테스트 책",
        chapter: "1장",
        thought: "기록은 남는다",
      },
    }).expect(200)
  ).body;
  w = (
    await call("put", `${path}/weeks/1/review`, {
      ...w.state.review,
      version: w.version,
      learned: "평가 보존",
    }).expect(200)
  ).body;
  const before = [w, await getWeek(2)],
    original = (await call("get", path).expect(200)).body;
  const t = templateFromDay(
    [
      shift,
      {
        ...shift,
        id: crypto.randomUUID(),
        kind: "strategy",
        title: "회복 정리",
        time: "07:00",
        minutes: 30,
      },
    ],
    6,
    "야간 근무형",
  );
  t.workBlockId = t.blocks[0].id;
  Object.assign(t.blocks[1], { anchor: "work-end", offset: 0 });
  const source = { ...original.plan, dayTemplates: [t], modelWeekMode: "day" };
  const generated = instantiateDayTemplate(t, "2026-10-11", {
    startDate: c.start_date,
    weekCount: 2,
    today: "2026-10-07",
  });
  const next = planWithDayTemplate(source, generated.blocks, [`1:${shift.id}`]);
  const input = {
    version: original.version,
    title: c.title,
    startDate: c.start_date,
    weekCount: 2,
    plan: next,
  };
  const saved = (await call("put", path, input).expect(200)).body;
  assert.deepEqual(saved.plan, next);
  for (const [i, old] of before.entries()) {
    const fresh = await getWeek(i + 1);
    assert.deepEqual(fresh.state, old.state);
    assert.deepEqual(fresh.score, old.score);
  }
  await other("get", path).expect(404);
  await other("put", path, input).expect(404);
  await call("put", path, input).expect(409);
  assert.deepEqual((await call("get", path).expect(200)).body.plan, next);
  const bad = structuredClone(next);
  bad.dayTemplates[0].workBlockId = crypto.randomUUID();
  await call("put", path, {
    ...input,
    version: saved.version,
    plan: bad,
  }).expect(400);
  assert.deepEqual((await call("get", path).expect(200)).body.plan, next);
  const health = (await request(app).get("/api/health").expect(200)).body;
  assert.equal(health.features.dayTemplates, 1);
});
