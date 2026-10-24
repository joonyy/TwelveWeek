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
after(async () => pool.end());
async function fixture() {
  const profile = (
    await request(app)
      .post("/api/profiles")
      .send({ name: `독서 ${randomUUID().slice(0, 8)}` })
  ).body;
  const { token } = (
    await request(app).post("/api/sessions").send({ profileId: profile.id })
  ).body;
  const call = (method, path, data) => {
    const r = request(app)
      [method](`/api${path}`)
      .set("Authorization", `Bearer ${token}`);
    return data ? r.send(data) : r;
  };
  const plan = emptyPlan(2);
  plan.goals[0].title = "읽고 활용하기";
  plan.goals[0].referenceUrl = "https://app.notion.com/p/example";
  Object.assign(plan.goals[0].tactics[0], {
    title: "단원 읽기",
    condition: "한 줄 생각",
    readingBook: "세컨드 브레인",
    count: 2,
    weeks: [1, 2],
  });
  let cycle = (
    await call("post", "/cycles", {
      title: "독서",
      startDate: "2026-10-05",
      weekCount: 2,
      plan,
    }).expect(201)
  ).body;
  const path = `/cycles/${cycle.id}`;
  cycle = (
    await call("post", `${path}/start`, { version: cycle.version }).expect(200)
  ).body;
  const getWeek = async (number = 1) =>
    (await call("get", `${path}/weeks/${number}`).expect(200)).body;
  let week = await getWeek();
  const id = week.state.occurrences[0].id;
  week = (
    await call("put", `${path}/weeks/1/occurrences/${id}/schedule`, {
      version: week.version,
      date: week.today,
      time: "10:00",
      minutes: 30,
    }).expect(200)
  ).body;
  return { call, path, cycle, getWeek, id, week };
}
const record = {
  book: "세컨드 브레인",
  chapter: "1장",
  thought: "저장보다 다시 꺼내 쓰는 것이 중요하다.",
};

test("reading drafts, atomic completion, correction and deletion preserve scoring promises", async () => {
  const f = await fixture();
  const path = `${f.path}/weeks/1/occurrences/${f.id}`;
  await f
    .call("put", `${path}/completion`, {
      version: f.week.version,
      completed: true,
    })
    .expect(400);
  let week = (
    await f
      .call("put", `${path}/reading-record`, {
        version: f.week.version,
        record,
      })
      .expect(200)
  ).body;
  assert.deepEqual(week.score, f.week.score);
  assert.deepEqual(week.daily, f.week.daily);
  assert.equal(week.state.occurrences[0].completed, false);
  assert.deepEqual(week.state.occurrences[0].readingRecord, record);
  const completed = (
    await f
      .call("put", `${path}/completion`, {
        version: week.version,
        completed: true,
      })
      .expect(200)
  ).body;
  assert.equal(completed.score.rows[0].done, 1);
  assert.equal(
    completed.state.occurrences[0].executedAt,
    "2026-10-07T03:00:00.000Z",
  );
  const edited = (
    await f
      .call("put", `${path}/reading-record`, {
        version: completed.version,
        record: { ...record, thought: "수정한 생각" },
      })
      .expect(200)
  ).body;
  assert.deepEqual(edited.score, completed.score);
  assert.deepEqual(edited.daily, completed.daily);
  await f
    .call("put", `${path}/reading-record`, {
      version: edited.version,
      record: null,
    })
    .expect(409);
  week = (
    await f
      .call("put", `${path}/completion`, {
        version: edited.version,
        completed: false,
      })
      .expect(200)
  ).body;
  assert.equal(week.state.occurrences[0].readingRecord.thought, "수정한 생각");
  week = (
    await f
      .call("put", `${path}/reading-record`, {
        version: week.version,
        record: null,
      })
      .expect(200)
  ).body;
  assert.equal(week.state.occurrences[0].readingRecord, undefined);
  assert.deepEqual(week.score, f.week.score);
  assert.deepEqual((await f.call("get", f.path)).body.plan, f.cycle.plan);
});

test("record validation, version and owner checks reject writes and exports atomically", async () => {
  const f = await fixture(),
    other = await fixture();
  const path = `${f.path}/weeks/1/occurrences/${f.id}/reading-record`;
  await other
    .call("put", path, { version: f.week.version, record })
    .expect(404);
  await f
    .call("put", path, { version: f.week.version + 1, record })
    .expect(409);
  await f
    .call("put", path, {
      version: f.week.version,
      record: { ...record, thought: " " },
    })
    .expect(400);
  await f
    .call("put", path, {
      version: f.week.version,
      record: { ...record, thought: "x".repeat(2001) },
    })
    .expect(400);
  await other.call("get", `${f.path}/reading-notes`).expect(404);
  await other.call("get", `${f.path}/reading-notes.md`).expect(404);
  assert.deepEqual(await f.getWeek(), f.week);
  const bad = structuredClone(f.cycle.plan);
  bad.goals[0].referenceUrl = "javascript:alert(1)";
  await f
    .call("put", f.path, {
      version: f.cycle.version,
      title: f.cycle.title,
      startDate: f.cycle.start_date,
      weekCount: 2,
      plan: bad,
    })
    .expect(400);
  assert.deepEqual((await f.call("get", f.path)).body.plan, f.cycle.plan);
});

test("book list and Markdown export preserve source state and future plan edits retain drafts", async () => {
  const f = await fixture();
  let future = await f.getWeek(2);
  const o = future.state.occurrences[0];
  future = (
    await f
      .call("put", `${f.path}/weeks/2/occurrences/${o.id}/reading-record`, {
        version: future.version,
        record,
      })
      .expect(200)
  ).body;
  const plan = structuredClone(f.cycle.plan);
  plan.responsibility = "기록 보존";
  await f
    .call("put", f.path, {
      version: f.cycle.version,
      title: f.cycle.title,
      startDate: f.cycle.start_date,
      weekCount: 2,
      plan,
    })
    .expect(200);
  const before = await f.getWeek(2);
  assert.deepEqual(before.state.occurrences[0].readingRecord, record);
  const notes = (await f.call("get", `${f.path}/reading-notes`).expect(200))
    .body;
  assert.equal(notes.records.length, 1);
  const markdown = await f
    .call("get", `${f.path}/reading-notes.md`)
    .expect(200);
  assert.match(markdown.headers["content-type"], /text\/markdown/);
  assert.ok(markdown.text.includes("## 세컨드 브레인"));
  assert.ok(markdown.text.includes("> 저장보다 다시 꺼내 쓰는 것이 중요하다."));
  assert.ok(markdown.text.includes("기록 초안"));
  assert.deepEqual(await f.getWeek(2), before);
  assert.deepEqual(await f.getWeek(), f.week);
});

test("reading and completion are saved together or neither is written", async () => {
  const f = await fixture(),
    path = `${f.path}/weeks/1/occurrences/${f.id}/completion`;
  await f
    .call("put", path, {
      version: f.week.version,
      completed: true,
      readingRecord: record,
      executedAt: "2026-10-08T12:00:00+09:00",
    })
    .expect(400);
  assert.deepEqual(await f.getWeek(), f.week);
  const saved = (
    await f
      .call("put", path, {
        version: f.week.version,
        completed: true,
        readingRecord: record,
      })
      .expect(200)
  ).body;
  assert.equal(saved.state.occurrences[0].completed, true);
  assert.deepEqual(saved.state.occurrences[0].readingRecord, record);
});
