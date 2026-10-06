import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import request from "supertest";
import { createPool } from "../server/db.js";
import { migrate } from "../server/migrate.js";
import { createApp } from "../server/app.js";
import { emptyPlan } from "../shared/domain.js";
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error(
    "TEST_DATABASE_URL must target a dedicated database ending in _test",
  );
const pool = createPool(url),
  app = createApp({
    pool,
    now: () => new Date("2026-10-07T12:00:00+09:00"),
    rateLimits: false,
  });
let owner, other, profileId, cycle, week;
const g = randomUUID(),
  t = randomUUID(),
  daily = randomUUID();
const plan = {
  ...emptyPlan(),
  longVision: "원하는 삶",
  goals: [
    {
      id: g,
      title: "꾸준한 실행",
      success: "결과",
      benefit: "변화",
      leading: "실행 횟수",
      lagging: "실제 결과",
      measurement: "주간",
      difficulties: [],
      tactics: [
        {
          id: t,
          title: "주 3회 러닝",
          condition: "5km 완주",
          kind: "weekly",
          count: 3,
          weeks: [1, 2],
        },
        {
          id: daily,
          title: "매일 기록",
          condition: "한 줄 기록",
          kind: "daily",
          count: 1,
          weeks: [1, 2],
        },
      ],
    },
  ],
};
const call = (method, path, body, who = owner) => {
  let r = request(app)[method](`/api${path}`);
  if (who) r = r.set("Authorization", `Bearer ${who}`);
  return body ? r.send(body) : r;
};
before(async () => {
  await migrate(pool);
  await pool.query(
    "TRUNCATE changes,weeks,cycles,sessions,profiles RESTART IDENTITY CASCADE",
  );
});
after(async () => {
  await pool.end();
});
test("health, username profiles, long sessions and token hashes", async () => {
  await request(app).get("/api/health").expect(200);
  const p = (await call("post", "/profiles", { name: "테스트 사용자" })).body;
  profileId = p.id;
  const session = (await call("post", "/sessions", { profileId: p.id })).body;
  owner = session.token;
  assert.equal(owner.length, 43);
  assert.equal(session.expiresAt, "2027-10-07T03:00:00.000Z");
  const stored = (
    await pool.query("SELECT token_hash FROM sessions WHERE profile_id=$1", [
      p.id,
    ])
  ).rows[0].token_hash;
  assert.notEqual(stored, owner);
  assert.equal(stored, createHash("sha256").update(owner).digest("hex"));
  const p2 = (await call("post", "/profiles", { name: "두 번째" })).body;
  other = (await call("post", "/sessions", { profileId: p2.id })).body.token;
  await call("post", "/profiles", { name: " 테스트 사용자 " }).expect(409);
  await call("get", "/me", null, "x".repeat(43)).expect(401);
});
test("Monday validation, full plan persistence and optimistic concurrency", async () => {
  await call("post", "/cycles", {
    title: "실패",
    startDate: "2026-10-06",
    plan,
  }).expect(400);
  cycle = (
    await call("post", "/cycles", {
      title: "첫 12주",
      startDate: "2026-10-05",
      plan,
    }).expect(201)
  ).body;
  assert.deepEqual(cycle.plan, plan);
  cycle = (
    await call("put", `/cycles/${cycle.id}`, {
      title: cycle.title,
      startDate: cycle.start_date,
      plan,
      version: 0,
    }).expect(200)
  ).body;
  await call("put", `/cycles/${cycle.id}`, {
    title: cycle.title,
    startDate: cycle.start_date,
    plan,
    version: 0,
  }).expect(409);
});
test("owner scope rejects another profile reading or changing the cycle", async () => {
  await call("get", `/cycles/${cycle.id}`, null, other).expect(404);
  await call(
    "put",
    `/cycles/${cycle.id}`,
    {
      title: "침범",
      startDate: cycle.start_date,
      plan,
      version: cycle.version,
    },
    other,
  ).expect(404);
  assert.equal((await call("get", "/cycles", null, other)).body.length, 0);
});
test("activation creates independent baselines for 12 weeks, no partial occurrence API", async () => {
  cycle = (
    await call("post", `/cycles/${cycle.id}/start`, {
      version: cycle.version,
    }).expect(200)
  ).body;
  week = (await call("get", `/cycles/${cycle.id}/weeks/1`).expect(200)).body;
  assert.equal(week.state.occurrences.length, 10);
  assert.equal(week.score.rows.length, 2);
  await call(
    "put",
    `/cycles/${cycle.id}/weeks/1/occurrences/${t}~0/completion`,
    { version: week.version, completed: 0.5 },
  ).expect(400);
  await call("get", `/cycles/${cycle.id}/weeks/13`).expect(400);
  await call("post", `/cycles/${cycle.id}/finish`, {}).expect(409);
  await call("get", `/cycles/${cycle.id}/weeks/1`, null, other).expect(404);
});
test("same-week movement allowed, next-week movement and skipped daily execution blocked", async () => {
  const prefix = `/cycles/${cycle.id}/weeks/1/occurrences`;
  week = (
    await call("put", `${prefix}/${t}~0/schedule`, {
      version: week.version,
      date: "2026-10-05",
      time: "09:00",
      minutes: 40,
    }).expect(200)
  ).body;
  week = (
    await call("put", `${prefix}/${t}~0/schedule`, {
      version: week.version,
      date: "2026-10-07",
      time: "09:00",
      minutes: 40,
    }).expect(200)
  ).body;
  await call("put", `${prefix}/${t}~0/schedule`, {
    version: week.version,
    date: "2026-10-12",
    time: "09:00",
    minutes: 40,
  }).expect(400);
  await call("put", `${prefix}/${t}~0/schedule`, {
    version: week.version,
    date: null,
    time: "09:00",
    minutes: 40,
  }).expect(409);
  await call("put", `${prefix}/${daily}~0/schedule`, {
    version: week.version,
    date: "2026-10-07",
    time: "09:00",
    minutes: 5,
  }).expect(409);
});
test("completions use real execution day and frozen equal tactic weights", async () => {
  const prefix = `/cycles/${cycle.id}/weeks/1/occurrences`;
  await call("put", `${prefix}/${t}~0/completion`, {
    version: week.version,
    completed: true,
    executedAt: "2026-10-07T03:59:00+09:00",
  }).expect(400);
  await call("put", `${prefix}/${t}~0/completion`, {
    version: week.version,
    completed: true,
    executedAt: "2026-10-08T10:00:00+09:00",
  }).expect(400);
  const prior = week.version;
  week = (
    await call("put", `${prefix}/${t}~0/completion`, {
      version: week.version,
      completed: true,
    }).expect(200)
  ).body;
  assert.equal(week.state.occurrences[0].completed, true);
  assert.ok(Math.abs(week.score.score - 100 / 6) < 1e-10);
  await call("put", `${prefix}/${t}~0/completion`, {
    version: prior,
    completed: false,
  }).expect(409);
  // A real next-calendar-day pre-04:00 execution belongs to the previous evaluation date.
  week = (
    await call("put", `${prefix}/${daily}~0/completion`, {
      version: week.version,
      completed: true,
      executedAt: "2026-10-06T02:00:00+09:00",
    }).expect(200)
  ).body;
  assert.equal(week.daily[0].done, 1);
});
test("shrinking a plan changes future weeks but never erases the current baseline", async () => {
  const revised = structuredClone(plan);
  revised.goals[0].tactics[0].count = 1;
  revised.goals[0].tactics = revised.goals[0].tactics.slice(0, 1);
  revised.goals[0].leading = "새 기준";
  cycle = (
    await call("put", `/cycles/${cycle.id}`, {
      title: cycle.title,
      startDate: cycle.start_date,
      plan: revised,
      version: cycle.version,
    }).expect(200)
  ).body;
  const current = (await call("get", `/cycles/${cycle.id}/weeks/1`)).body,
    future = (await call("get", `/cycles/${cycle.id}/weeks/2`)).body;
  assert.equal(current.state.occurrences.length, 10);
  assert.equal(current.state.tactics[0].plannedCount, 3);
  assert.equal(current.state.tactics[0].goalLeading, "실행 횟수");
  assert.equal(current.score.score, week.score.score);
  assert.equal(future.state.occurrences.length, 1);
  assert.equal(future.state.tactics[0].plannedCount, 1);
});
test("weekly metrics persist without changing execution score, ICS downloads owned data", async () => {
  const score = week.score.score;
  week = (
    await call("put", `/cycles/${cycle.id}/weeks/1/review`, {
      version: week.version,
      learned: "야간근무 다음 날은 회복 필요",
      next: "다음 주 전술 조정",
      metrics: { [g]: { leading: "1회", lagging: "변화 관찰 중" } },
    }).expect(200)
  ).body;
  assert.equal(week.score.score, score);
  assert.equal(week.state.review.metrics[g].leading, "1회");
  assert.ok(week.state.reviewSavedAt);
  const ics = await call(
    "get",
    `/cycles/${cycle.id}/weeks/1/calendar.ics`,
  ).expect(200);
  assert.match(ics.text, /BEGIN:VCALENDAR/);
  assert.equal((ics.text.match(/BEGIN:VEVENT/g) || []).length, 8);
  await call(
    "get",
    `/cycles/${cycle.id}/weeks/1/calendar.ics`,
    null,
    other,
  ).expect(404);
  assert.ok(
    (
      await pool.query(
        "SELECT COUNT(*)::int AS count FROM changes WHERE cycle_id=$1",
        [cycle.id],
      )
    ).rows[0].count >= 7,
  );
});
test("result metrics can be reviewed even in a week without scheduled tactics", async () => {
  const empty = (await call("get", `/cycles/${cycle.id}/weeks/3`)).body;
  assert.equal(empty.score.score, null);
  assert.equal(empty.state.goals.length, 1);
  const saved = (
    await call("put", `/cycles/${cycle.id}/weeks/3/review`, {
      version: empty.version,
      learned: "",
      next: "",
      metrics: { [g]: { leading: "배정 없음", lagging: "결과 관찰" } },
    }).expect(200)
  ).body;
  assert.equal(saved.score.score, null);
  assert.equal(saved.state.review.metrics[g].lagging, "결과 관찰");
});
test("13th-week reflection persists, finish preserves read-only history and permits a new season", async () => {
  cycle = (
    await call("put", `/cycles/${cycle.id}/reflection`, {
      version: cycle.version,
      results: "실행이 쌓임",
      lessons: "회복 필요",
      next: "다음 방향",
    }).expect(200)
  ).body;
  assert.equal(cycle.reflection.results, "실행이 쌓임");
  await call("put", `/cycles/${cycle.id}/reflection`, {
    version: cycle.version - 1,
    results: "덮어쓰기",
    lessons: "",
    next: "",
  }).expect(409);
  const late = createApp({
    pool,
    now: () => new Date("2026-12-28T04:00:00+09:00"),
    rateLimits: false,
  });
  await request(late)
    .post(`/api/cycles/${cycle.id}/finish`)
    .set("Authorization", `Bearer ${owner}`)
    .expect(200);
  const history = (await call("get", `/cycles/${cycle.id}`)).body;
  assert.equal(history.status, "complete");
  assert.equal(history.reflection.lessons, "회복 필요");
  await call("put", `/cycles/${cycle.id}/weeks/1/review`, {
    version: week.version,
    learned: "변경",
    next: "",
    metrics: {},
  }).expect(409);
  const nextCycle = (
    await call("post", "/cycles", {
      title: "다음 계절",
      startDate: "2027-01-04",
      plan,
    }).expect(201)
  ).body;
  await call("post", `/cycles/${nextCycle.id}/start`, {
    version: nextCycle.version,
  }).expect(200);
});
test("new editor persists modes and wheel choices, ignores blank starter goals at activation", async () => {
  const profile = (await call("post", "/profiles", { name: "새 작성 방식" }))
    .body;
  const who = (await call("post", "/sessions", { profileId: profile.id })).body
    .token;
  let draft = (
    await call(
      "post",
      "/cycles",
      { title: "새 양식", startDate: "2026-10-05" },
      who,
    ).expect(201)
  ).body;
  assert.equal(draft.plan.goals.length, 3);
  await call(
    "post",
    `/cycles/${draft.id}/start`,
    { version: draft.version },
    who,
  ).expect(400);
  const p = draft.plan;
  p.longVision = "첫 비전\n두 번째 비전";
  p.visionModes.longVision = "text";
  p.responsibilityActions.business = "실천";
  p.commitments[0].accepted = true;
  p.commitments[0].action = "핵심 행동";
  p.goals[0].title = "의미 있는 목표";
  p.goals[0].tactics[0].title = "실행";
  p.goals[0].tactics[0].condition = "완료 기준";
  p.goals[1].success = "입력 중인 기준";
  draft = (
    await call(
      "put",
      `/cycles/${draft.id}`,
      {
        title: draft.title,
        startDate: draft.start_date,
        plan: p,
        version: draft.version,
      },
      who,
    ).expect(200)
  ).body;
  await call(
    "post",
    `/cycles/${draft.id}/start`,
    { version: draft.version },
    who,
  ).expect(400);
  p.goals[1].success = "";
  draft = (
    await call(
      "put",
      `/cycles/${draft.id}`,
      {
        title: draft.title,
        startDate: draft.start_date,
        plan: p,
        version: draft.version,
      },
      who,
    ).expect(200)
  ).body;
  await call(
    "post",
    `/cycles/${draft.id}/start`,
    { version: draft.version },
    who,
  ).expect(200);
  const w = (await call("get", `/cycles/${draft.id}/weeks/1`, null, who)).body;
  assert.equal(w.state.goals.length, 1);
  assert.equal(w.state.tactics.length, 1);
  const saved = (await call("get", `/cycles/${draft.id}`, null, who)).body;
  assert.equal(saved.plan.visionModes.longVision, "text");
  assert.equal(saved.plan.commitments[0].accepted, true);
  assert.equal(saved.plan.responsibilityActions.business, "실천");
  assert.equal(saved.plan.longVision, "첫 비전\n두 번째 비전");
});
test("sessions can be revoked and expired tokens cannot resume", async () => {
  await call("delete", "/sessions/current", null, other).expect(204);
  await call("get", "/me", null, other).expect(401);
  await pool.query(
    "UPDATE sessions SET expires_at='2026-01-01' WHERE profile_id=$1",
    [profileId],
  );
  await call("get", "/me").expect(401);
});
test("eleven-week activation and finish use selected duration and keep legacy default", async () => {
  const profile = (await call("post", "/profiles", { name: "11주 검증" })).body;
  const who = (await call("post", "/sessions", { profileId: profile.id })).body
    .token;
  for (const weekCount of [0, 13, 1.5])
    await call(
      "post",
      "/cycles",
      {
        title: "잘못된 기간",
        startDate: "2026-10-12",
        weekCount,
      },
      who,
    ).expect(400);
  const legacy = (
    await call(
      "post",
      "/cycles",
      {
        title: "기본 기간",
        startDate: "2026-10-12",
      },
      who,
    ).expect(201)
  ).body;
  assert.equal(legacy.week_count, 12);
  let c = (
    await call(
      "post",
      "/cycles",
      {
        title: "11주",
        startDate: "2026-10-12",
        weekCount: 11,
      },
      who,
    ).expect(201)
  ).body;
  assert.equal(c.week_count, 11);
  assert.equal(c.plan.goals[0].tactics[0].weeks.length, 11);
  assert.equal(
    (await call("get", "/cycles", null, who)).body.find((x) => x.id === c.id)
      .week_count,
    11,
  );
  c.plan.goals[0].title = "기간 안의 결과";
  c.plan.goals[0].tactics[0].title = "핵심 실행";
  c.plan.goals[0].tactics[0].condition = "완료 기준";
  c = (
    await call(
      "put",
      `/cycles/${c.id}`,
      {
        title: c.title,
        startDate: c.start_date,
        plan: c.plan,
        version: c.version,
      },
      who,
    ).expect(200)
  ).body;
  assert.equal(c.week_count, 11); // Old clients omitting the field keep the saved duration.
  c = (
    await call(
      "post",
      `/cycles/${c.id}/start`,
      { version: c.version },
      who,
    ).expect(200)
  ).body;
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS count FROM weeks WHERE cycle_id=$1",
        [c.id],
      )
    ).rows[0].count,
    11,
  );
  await call("get", `/cycles/${c.id}/weeks/11`, null, who).expect(200);
  await call("get", `/cycles/${c.id}/weeks/12`, null, who).expect(400);
  for (const [now, status] of [
    ["2026-12-28T03:59:59+09:00", 409],
    ["2026-12-28T04:00:00+09:00", 200],
  ]) {
    const timed = createApp({
      pool,
      now: () => new Date(now),
      rateLimits: false,
    });
    await request(timed)
      .post(`/api/cycles/${c.id}/finish`)
      .set("Authorization", `Bearer ${who}`)
      .expect(status);
  }
});
test("active shortening excludes future weeks without deleting records or changing frozen scores", async () => {
  const profile = (await call("post", "/profiles", { name: "기간 변경 검증" }))
    .body;
  const who = (await call("post", "/sessions", { profileId: profile.id })).body
    .token;
  const p = structuredClone(plan);
  p.goals[0].tactics.forEach((t) => {
    t.weeks = [1, 11, 12];
  });
  let c = (
    await call(
      "post",
      "/cycles",
      {
        title: "12에서 11로",
        startDate: "2026-10-05",
        plan: p,
      },
      who,
    ).expect(201)
  ).body;
  c = (
    await call(
      "post",
      `/cycles/${c.id}/start`,
      { version: c.version },
      who,
    ).expect(200)
  ).body;
  let first = (await call("get", `/cycles/${c.id}/weeks/1`, null, who)).body;
  first = (
    await call(
      "put",
      `/cycles/${c.id}/weeks/1/occurrences/${t}~0/schedule`,
      {
        version: first.version,
        date: "2026-10-07",
        time: "19:00",
        minutes: 60,
      },
      who,
    ).expect(200)
  ).body;
  first = (
    await call(
      "put",
      `/cycles/${c.id}/weeks/1/occurrences/${t}~0/completion`,
      {
        version: first.version,
        completed: true,
      },
      who,
    ).expect(200)
  ).body;
  const last = (await call("get", `/cycles/${c.id}/weeks/12`, null, who)).body;
  const update = (weeks) => ({
    title: c.title,
    startDate: c.start_date,
    plan: p,
    version: c.version,
    weekCount: weeks,
  });
  c = (await call("put", `/cycles/${c.id}`, update(11), who).expect(200)).body;
  assert.equal(c.week_count, 11);
  assert.deepEqual(
    (await call("get", `/cycles/${c.id}/weeks/1`, null, who)).body,
    first,
  );
  assert.deepEqual(c.plan.goals[0].tactics[0].weeks, [1, 11]);
  await call("get", `/cycles/${c.id}/weeks/12`, null, who).expect(400);
  const retained = (
    await pool.query("SELECT * FROM weeks WHERE cycle_id=$1 AND number=12", [
      c.id,
    ])
  ).rows[0];
  assert.deepEqual(retained.state, last.state);
  assert.equal(retained.version, last.version);
  await call("put", `/cycles/${c.id}`, update(12), who).expect(409);
  const late = createApp({
    pool,
    now: () => new Date("2026-10-12T04:00:00+09:00"),
    rateLimits: false,
  });
  await request(late)
    .put(`/api/cycles/${c.id}`)
    .set("Authorization", `Bearer ${who}`)
    .send(update(1))
    .expect(409);
  assert.equal(
    (await call("get", `/cycles/${c.id}`, null, who)).body.week_count,
    11,
  );
  const change = (
    await pool.query(
      "SELECT detail FROM changes WHERE cycle_id=$1 AND kind='cycle.length_changed'",
      [c.id],
    )
  ).rows[0];
  assert.deepEqual(change.detail, {
    fromWeeks: 12,
    toWeeks: 11,
    retainedWeekRecords: true,
  });
});
