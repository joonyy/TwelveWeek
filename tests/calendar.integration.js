import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createPool } from "../server/db.js";
import { migrate } from "../server/migrate.js";
import { createApp } from "../server/app.js";
import { emptyPlan } from "../shared/domain.js";
import { mockCalendarProvider } from "./calendar-fixture.js";
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw Error("Calendar tests require a dedicated _test database");
const pool = createPool(url),
  mock = mockCalendarProvider();
const app = createApp({
  pool,
  rateLimits: false,
  now: () => new Date("2026-10-07T03:00:00Z"),
  calendarProvider: mock.provider,
  aiEnv: { CALENDAR_SECRETS_KEY: "calendar-test-only-secret-32-characters" },
});
let owner, other, profileId, cycle, preview;
const plan = emptyPlan(2);
plan.goals[0].title = "주간 학습";
Object.assign(plan.goals[0].tactics[0], {
  title: "학습 결과 남기기",
  condition: "직접 설명",
  count: 2,
  weeks: [1, 2],
});
const call = (method, path, data, who = owner) => {
  let r = request(app)[method](`/api${path}`);
  if (who) r = r.set("Authorization", `Bearer ${who}`);
  return data ? r.send(data) : r;
};
const input = () => ({
  version: cycle.version,
  week: 1,
  calendars: ["work", "study"],
  target: "study",
});
const placements = (c) =>
  c.state.occurrences.map((o) => ({
    occurrenceId: o.id,
    date: "2026-10-06",
    time: "10:00",
    minutes: 60,
    action: "skip",
    allowOverlap: false,
  }));
before(async () => {
  await migrate(pool);
  await pool.query(
    "TRUNCATE changes,weeks,cycles,sessions,profiles RESTART IDENTITY CASCADE",
  );
});
after(async () => pool.end());
test("iCloud credentials are encrypted, owned and never returned", async () => {
  const p = (
    await call("post", "/profiles", {
      password: "test-password",
      name: "Calendar owner",
    })
  ).body;
  profileId = p.id;
  owner = (
    await call("post", "/sessions", {
      password: "test-password",
      profileId: p.id,
    })
  ).body.token;
  const p2 = (
    await call("post", "/profiles", {
      password: "test-password",
      name: "Calendar other",
    })
  ).body;
  other = (
    await call("post", "/sessions", {
      password: "test-password",
      profileId: p2.id,
    })
  ).body.token;
  const config = (await call("get", "/calendar/apple").expect(200)).body;
  assert.equal(config.connected, false);
  const connected = (
    await call("put", "/calendar/apple", {
      username: "test@example.com",
      password: "abcd-efgh-ijkl-mnop",
    }).expect(200)
  ).body;
  assert.equal(connected.calendars.length, 2);
  assert.equal(JSON.stringify(connected).includes("abcd-efgh"), false);
  const stored = (
    await pool.query(
      "SELECT secret_cipher FROM calendar_connections WHERE profile_id=$1",
      [profileId],
    )
  ).rows[0].secret_cipher;
  assert.equal(stored.includes("abcd-efgh"), false);
  assert.equal(
    (await call("get", "/calendar/apple", null, other)).body.connected,
    false,
  );
  cycle = (
    await call("post", "/cycles", {
      title: "Calendar test",
      startDate: "2026-10-05",
      weekCount: 2,
      plan,
    }).expect(201)
  ).body;
  await call(
    "post",
    `/calendar/cycles/${cycle.id}/context`,
    input(),
    other,
  ).expect(404);
});
test("read and preview have no external writes; reviewed create/link apply once and preserve drafts", async () => {
  const context = (
    await call("post", `/calendar/cycles/${cycle.id}/context`, input()).expect(
      200,
    )
  ).body;
  const p = placements(context);
  p[0].action = "create";
  p[1].action = "create";
  p[1].date = "2026-10-07";
  p[1].time = "18:00";
  await call("post", `/calendar/cycles/${cycle.id}/preview`, {
    ...input(),
    fingerprint: context.fingerprint,
    weekVersion: context.weekVersion,
    placements: p,
  }).expect(409);
  p[0].action = "link";
  p[0].linkId = "work-event";
  preview = (
    await call("post", `/calendar/cycles/${cycle.id}/preview`, {
      ...input(),
      fingerprint: context.fingerprint,
      weekVersion: context.weekVersion,
      placements: p,
    }).expect(200)
  ).body;
  assert.equal(preview.create, 1);
  assert.equal(preview.link, 1);
  assert.equal(mock.state.calls, 0);
  const unchanged = (await call("get", `/cycles/${cycle.id}`)).body;
  assert.deepEqual(unchanged.plan, plan);
  await call(
    "post",
    `/calendar/cycles/${cycle.id}/previews/${preview.id}/apply`,
    { confirmed: true },
    other,
  ).expect(404);
  const applied = (
    await call(
      "post",
      `/calendar/cycles/${cycle.id}/previews/${preview.id}/apply`,
      { confirmed: true },
    ).expect(200)
  ).body;
  assert.equal(applied.ok, true);
  assert.equal(mock.state.calls, 1);
  cycle = applied.cycle;
  assert.equal(cycle.status, "draft");
  assert.deepEqual(cycle.plan.goals, plan.goals);
  assert.equal(cycle.plan.weeklySchedules[0].placements.length, 2);
  const replay = (
    await call(
      "post",
      `/calendar/cycles/${cycle.id}/previews/${preview.id}/apply`,
      { confirmed: true },
    ).expect(200)
  ).body;
  assert.equal(replay.replayed, true);
  assert.equal(mock.state.calls, 1);
  const edited = structuredClone(cycle.plan);
  edited.longVision = "새로 작성한 비전";
  cycle = (
    await call("put", `/cycles/${cycle.id}`, {
      title: cycle.title,
      startDate: cycle.start_date,
      weekCount: 2,
      version: cycle.version,
      plan: edited,
    }).expect(200)
  ).body;
  const latestReplay = (
    await call(
      "post",
      `/calendar/cycles/${cycle.id}/previews/${preview.id}/apply`,
      { confirmed: true },
    ).expect(200)
  ).body;
  assert.equal(latestReplay.cycle.version, cycle.version);
  assert.equal(latestReplay.cycle.plan.longVision, "새로 작성한 비전");
});
test("activation keeps prepared schedules without dropping or completing executions", async () => {
  cycle = (
    await call("post", `/cycles/${cycle.id}/start`, {
      version: cycle.version,
    }).expect(200)
  ).body;
  const week = (await call("get", `/cycles/${cycle.id}/weeks/1`).expect(200))
    .body;
  assert.equal(week.state.occurrences.length, 2);
  assert.ok(week.state.occurrences.every((o) => !o.completed));
  assert.deepEqual(
    week.state.occurrences.map((o) => [o.date, o.time]),
    [
      ["2026-10-06", "10:00"],
      ["2026-10-07", "18:00"],
    ],
  );
  assert.equal(week.score.rows[0].plannedCount, 2);
  const occurrence = week.state.occurrences[1];
  const calls = mock.state.calls;
  const moved = (
    await call(
      "put",
      `/cycles/${cycle.id}/weeks/1/occurrences/${occurrence.id}/schedule`,
      {
        version: week.version,
        date: occurrence.date,
        time: "19:00",
        minutes: 45,
      },
    ).expect(200)
  ).body;
  assert.equal(moved.state.occurrences[1].calendarLink, undefined);
  assert.equal(moved.score.rows[0].plannedCount, 2);
  assert.equal(mock.state.calls, calls);
});
test("changed Apple events and changed plan versions invalidate review before writes", async () => {
  const c = (
    await call("post", `/calendar/cycles/${cycle.id}/context`, input()).expect(
      200,
    )
  ).body;
  const p = placements(c);
  p[0].action = "link";
  p[0].linkId = "work-event";
  const review = (
    await call("post", `/calendar/cycles/${cycle.id}/preview`, {
      ...input(),
      fingerprint: c.fingerprint,
      weekVersion: c.weekVersion,
      placements: p,
    }).expect(200)
  ).body;
  const calls = mock.state.calls;
  mock.state.events[0].etag = "changed";
  await call(
    "post",
    `/calendar/cycles/${cycle.id}/previews/${review.id}/apply`,
    { confirmed: true },
  ).expect(409);
  assert.equal(mock.state.calls, calls);
  const newer = (
    await call("post", `/calendar/cycles/${cycle.id}/context`, input()).expect(
      200,
    )
  ).body;
  const review2 = (
    await call("post", `/calendar/cycles/${cycle.id}/preview`, {
      ...input(),
      fingerprint: newer.fingerprint,
      weekVersion: newer.weekVersion,
      placements: p,
    }).expect(200)
  ).body;
  const edited = structuredClone(cycle.plan);
  edited.longVision = "동시 편집";
  cycle = (
    await call("put", `/cycles/${cycle.id}`, {
      title: cycle.title,
      startDate: cycle.start_date,
      weekCount: 2,
      version: cycle.version,
      plan: edited,
    }).expect(200)
  ).body;
  await call(
    "post",
    `/calendar/cycles/${cycle.id}/previews/${review2.id}/apply`,
    { confirmed: true },
  ).expect(409);
  assert.equal(mock.state.calls, calls);
});
test("partial remote failure is explicit and repeated apply cannot duplicate earlier writes", async () => {
  const draft = (
    await call("post", "/cycles", {
      title: "Partial batch",
      startDate: "2026-10-05",
      weekCount: 2,
      plan,
    }).expect(201)
  ).body;
  const params = { ...input(), version: draft.version };
  const c = (
    await call("post", `/calendar/cycles/${draft.id}/context`, params).expect(
      200,
    )
  ).body;
  const p = placements(c);
  for (let i = 0; i < p.length; i++)
    Object.assign(p[i], {
      action: "create",
      date: i ? "2026-10-08" : "2026-10-09",
      time: "20:00",
    });
  const review = (
    await call("post", `/calendar/cycles/${draft.id}/preview`, {
      ...params,
      fingerprint: c.fingerprint,
      weekVersion: c.weekVersion,
      placements: p,
    }).expect(200)
  ).body;
  mock.state.calls = 0;
  mock.state.failAt = 2;
  const result = (
    await call(
      "post",
      `/calendar/cycles/${draft.id}/previews/${review.id}/apply`,
      { confirmed: true },
    ).expect(200)
  ).body;
  assert.equal(result.ok, false);
  assert.equal(result.partial, true);
  assert.equal(result.applied.length, 1);
  const current = (await call("get", `/cycles/${draft.id}`)).body;
  assert.equal(current.version, draft.version);
  assert.deepEqual(current.plan, plan);
  await call(
    "post",
    `/calendar/cycles/${draft.id}/previews/${review.id}/apply`,
    { confirmed: true },
  ).expect(200);
  assert.equal(mock.state.calls, 2);
  await call("delete", "/calendar/apple").expect(204);
  assert.equal((await call("get", "/calendar/apple")).body.connected, false);
  await call(
    "post",
    `/calendar/cycles/${draft.id}/previews/${review.id}/apply`,
    { confirmed: true },
  ).expect(404);
});
