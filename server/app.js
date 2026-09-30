import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { transaction } from "./db.js";
import {
  cycleInput,
  scheduleInput,
  completeInput,
  reviewInput,
} from "./schema.js";
import {
  emptyPlan,
  prepareWeek,
  weekStart,
  addDays,
  evaluationDate,
  scoreWeek,
  scoreDay,
  weekGoals,
} from "../shared/domain.js";
import { calendar } from "./calendar.js";
import { hasGoalContent, hasTacticContent } from "../shared/planning.js";
const hash = (t) => createHash("sha256").update(t).digest("hex");
function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}
function version(actual, expected) {
  if (actual !== expected)
    fail(
      409,
      "다른 화면에서 내용이 변경됐어요. 새로 불러온 뒤 다시 시도해주세요.",
    );
}
const uuid = z.uuid();
const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .refine((v) => !/[\x00-\x1f\x7f]/.test(v));
export function createApp({
  pool,
  now = () => new Date(),
  webOrigin = process.env.WEB_ORIGIN || "http://localhost:5178",
  rateLimits = true,
}) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet());
  const origins = webOrigin.split(",").map((s) => s.trim());
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || origins.includes(origin)),
      methods: ["GET", "POST", "PUT", "DELETE"],
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.get("/api/health", async (req, res) => {
    await pool.query("SELECT 1");
    res.json({ ok: true, service: "twelve-week", time: now().toISOString() });
  });
  if (rateLimits)
    app.use(
      "/api/profiles",
      rateLimit({
        windowMs: 60_000,
        limit: 60,
        standardHeaders: "draft-8",
        legacyHeaders: false,
      }),
    );
  if (rateLimits)
    app.use(
      "/api/sessions",
      rateLimit({
        windowMs: 60_000,
        limit: 30,
        standardHeaders: "draft-8",
        legacyHeaders: false,
      }),
    );
  app.get("/api/profiles", async (req, res) => {
    const rows = await pool.query(
      "SELECT id,name FROM profiles ORDER BY created_at LIMIT 200",
    );
    res.json(rows.rows);
  });
  app.post("/api/profiles", async (req, res) => {
    const name = nameSchema.parse(req.body.name).normalize("NFKC").trim();
    if (!name) fail(400, "유저명을 입력해주세요.");
    try {
      const result = await pool.query(
        "INSERT INTO profiles(id,name,normalized_name) VALUES($1,$2,$3) RETURNING id,name",
        [randomUUID(), name, name.toLocaleLowerCase("ko-KR")],
      );
      res.status(201).json(result.rows[0]);
    } catch (e) {
      if (e.code === "23505")
        fail(409, "이미 있는 유저명이에요. 목록에서 선택해주세요.");
      throw e;
    }
  });
  app.post("/api/sessions", async (req, res) => {
    const profileId = uuid.parse(req.body.profileId);
    const profile = (
      await pool.query("SELECT id,name FROM profiles WHERE id=$1", [profileId])
    ).rows[0];
    if (!profile) fail(404, "유저를 찾을 수 없어요.");
    const token = randomBytes(32).toString("base64url");
    const ttl = Number(process.env.TOKEN_TTL_DAYS || 365);
    if (!Number.isInteger(ttl) || ttl < 1 || ttl > 730)
      throw new Error("TOKEN_TTL_DAYS must be between 1 and 730");
    const expiresAt = new Date(+now() + ttl * 86400000);
    await pool.query("DELETE FROM sessions WHERE expires_at < $1", [now()]);
    await pool.query(
      "INSERT INTO sessions(token_hash,profile_id,expires_at) VALUES($1,$2,$3)",
      [hash(token), profile.id, expiresAt],
    );
    res.json({ token, expiresAt, profile });
  });
  app.use("/api", async (req, res, next) => {
    const token = req.headers.authorization?.match(
      /^Bearer ([A-Za-z0-9_-]{43})$/,
    )?.[1];
    if (!token) fail(401, "유저를 선택해주세요.");
    const result = await pool.query(
      "SELECT p.id,p.name FROM sessions s JOIN profiles p ON p.id=s.profile_id WHERE s.token_hash=$1 AND s.expires_at>$2",
      [hash(token), now()],
    );
    if (!result.rowCount)
      fail(401, "로그인 유지 기간이 끝났어요. 유저를 다시 선택해주세요.");
    req.profile = result.rows[0];
    req.tokenHash = hash(token);
    next();
  });
  app.get("/api/me", (req, res) =>
    res.json({
      profile: req.profile,
      evaluationDate: evaluationDate(now()),
      serverTime: now().toISOString(),
    }),
  );
  app.delete("/api/sessions/current", async (req, res) => {
    await pool.query("DELETE FROM sessions WHERE token_hash=$1", [
      req.tokenHash,
    ]);
    res.status(204).end();
  });
  const owned = async (db, req, lock = false) => {
    const id = uuid.parse(req.params.cycleId);
    const cycle = (
      await db.query(
        `SELECT * FROM cycles WHERE id=$1 AND profile_id=$2${lock ? " FOR UPDATE" : ""}`,
        [id, req.profile.id],
      )
    ).rows[0];
    if (!cycle) fail(404, "주기를 찾을 수 없어요.");
    return cycle;
  };
  const audit = (db, req, cycle, kind, detail) =>
    db.query(
      "INSERT INTO changes(profile_id,cycle_id,kind,detail) VALUES($1,$2,$3,$4)",
      [req.profile.id, cycle.id, kind, JSON.stringify(detail)],
    );
  app.get("/api/cycles", async (req, res) =>
    res.json(
      (
        await pool.query(
          "SELECT id,title,start_date,status,version,updated_at FROM cycles WHERE profile_id=$1 ORDER BY created_at DESC",
          [req.profile.id],
        )
      ).rows,
    ),
  );
  app.post("/api/cycles", async (req, res) => {
    const input = cycleInput.parse({
      ...req.body,
      plan: req.body.plan ?? emptyPlan(),
      version: 0,
    });
    if (new Date(`${input.startDate}T00:00:00Z`).getUTCDay() !== 1)
      fail(400, "시작일은 월요일로 선택해주세요.");
    res
      .status(201)
      .json(
        (
          await pool.query(
            "INSERT INTO cycles(id,profile_id,title,start_date,plan) VALUES($1,$2,$3,$4,$5) RETURNING *",
            [
              randomUUID(),
              req.profile.id,
              input.title,
              input.startDate,
              JSON.stringify(input.plan),
            ],
          )
        ).rows[0],
      );
  });
  app.get("/api/cycles/:cycleId", async (req, res) =>
    res.json(await owned(pool, req)),
  );
  app.put("/api/cycles/:cycleId", async (req, res) => {
    const input = cycleInput.parse(req.body);
    if (new Date(`${input.startDate}T00:00:00Z`).getUTCDay() !== 1)
      fail(400, "시작일은 월요일로 선택해주세요.");
    const result = await transaction(pool, async (db) => {
      const cycle = await owned(db, req, true);
      version(cycle.version, input.version);
      if (cycle.status === "complete")
        fail(409, "마친 주기는 기록으로 보관돼요.");
      if (cycle.status === "active" && input.startDate !== cycle.start_date)
        fail(409, "시작한 주기의 날짜는 바꿀 수 없어요.");
      const changed = (
        await db.query(
          "UPDATE cycles SET title=$1,start_date=$2,plan=$3,version=version+1,updated_at=now() WHERE id=$4 RETURNING *",
          [input.title, input.startDate, JSON.stringify(input.plan), cycle.id],
        )
      ).rows[0];
      if (cycle.status === "active") {
        const weeks = (
          await db.query(
            "SELECT * FROM weeks WHERE cycle_id=$1 ORDER BY number FOR UPDATE",
            [cycle.id],
          )
        ).rows;
        for (const w of weeks)
          if (weekStart(cycle.start_date, w.number) > evaluationDate(now())) {
            await db.query(
              "UPDATE weeks SET state=$1,version=version+1,updated_at=now() WHERE cycle_id=$2 AND number=$3",
              [
                JSON.stringify(
                  prepareWeek(input.plan, cycle.start_date, w.number, w.state),
                ),
                cycle.id,
                w.number,
              ],
            );
          }
      }
      await audit(db, req, cycle, "plan.updated", {
        fromVersion: cycle.version,
        appliesTo: "draft-or-future-weeks",
        before: cycle.plan,
        after: input.plan,
      });
      return changed;
    });
    res.json(result);
  });
  app.post("/api/cycles/:cycleId/start", async (req, res) => {
    const input = z
      .object({ version: z.number().int().min(0) })
      .parse(req.body);
    const cycle = await transaction(pool, async (db) => {
      // Serialize starts on the profile, also enforced by partial unique index.
      await db.query("SELECT id FROM profiles WHERE id=$1 FOR UPDATE", [
        req.profile.id,
      ]);
      const c = await owned(db, req, true);
      version(c.version, input.version);
      if (c.status !== "draft") fail(409, "이미 시작한 주기예요.");
      if (
        (
          await db.query(
            "SELECT 1 FROM cycles WHERE profile_id=$1 AND status='active'",
            [req.profile.id],
          )
        ).rowCount
      )
        fail(409, "진행 중인 주기를 먼저 마무리해주세요.");
      const populatedGoals = c.plan.goals.filter(hasGoalContent);
      if (
        !populatedGoals.length ||
        populatedGoals.some(
          (g) =>
            !g.title.trim() ||
            !g.tactics.filter(hasTacticContent).length ||
            g.tactics
              .filter(hasTacticContent)
              .some(
                (t) =>
                  !t.title.trim() || !t.condition.trim() || !t.weeks.length,
              ),
        )
      )
        fail(400, "목표와 전술, 1회 완료 조건, 실행 주차를 먼저 채워주세요.");
      for (let number = 1; number <= 12; number++)
        await db.query(
          "INSERT INTO weeks(cycle_id,number,state) VALUES($1,$2,$3)",
          [
            c.id,
            number,
            JSON.stringify(prepareWeek(c.plan, c.start_date, number)),
          ],
        );
      await audit(db, req, c, "cycle.started", {});
      return (
        await db.query(
          "UPDATE cycles SET status='active',version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
          [c.id],
        )
      ).rows[0];
    });
    res.json(cycle);
  });
  app.post("/api/cycles/:cycleId/finish", async (req, res) => {
    const c = await transaction(pool, async (db) => {
      const c = await owned(db, req, true);
      if (
        c.status !== "active" ||
        evaluationDate(now()) < addDays(c.start_date, 84)
      )
        fail(409, "12주 실행 뒤 회고 주간에 마무리할 수 있어요.");
      return (
        await db.query(
          "UPDATE cycles SET status='complete',version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
          [c.id],
        )
      ).rows[0];
    });
    res.json(c);
  });
  app.put("/api/cycles/:cycleId/reflection", async (req, res) => {
    const input = z
      .object({
        version: z.number().int().min(0),
        results: z.string().max(6000),
        lessons: z.string().max(6000),
        next: z.string().max(6000),
      })
      .parse(req.body);
    res.json(
      await transaction(pool, async (db) => {
        const c = await owned(db, req, true);
        version(c.version, input.version);
        if (c.status !== "active")
          fail(409, "진행 중인 12주의 회고만 수정할 수 있어요.");
        const reflection = {
          results: input.results,
          lessons: input.lessons,
          next: input.next,
          savedAt: now().toISOString(),
        };
        await audit(db, req, c, "reflection.saved", {
          before: c.reflection,
          after: reflection,
        });
        return (
          await db.query(
            "UPDATE cycles SET reflection=$1,version=version+1,updated_at=now() WHERE id=$2 RETURNING *",
            [JSON.stringify(reflection), c.id],
          )
        ).rows[0];
      }),
    );
  });
  const getWeek = async (db, req, lock = false) => {
    const cycle = await owned(db, req, lock);
    const number = z.coerce
      .number()
      .int()
      .min(1)
      .max(12)
      .parse(req.params.week);
    const week = (
      await db.query(
        `SELECT * FROM weeks WHERE cycle_id=$1 AND number=$2${lock ? " FOR UPDATE" : ""}`,
        [cycle.id, number],
      )
    ).rows[0];
    if (!week) fail(404, "12주 착수 후 주간 계획을 사용할 수 있어요.");
    return { cycle, week };
  };
  const present = (cycle, week) => ({
    ...week,
    score: scoreWeek(week.state),
    start: weekStart(cycle.start_date, week.number),
    today: evaluationDate(now()),
    daily: Array.from({ length: 7 }, (_, i) => {
      const date = addDays(weekStart(cycle.start_date, week.number), i);
      return { date, ...scoreDay(week.state, date) };
    }),
  });
  app.get("/api/cycles/:cycleId/weeks/:week", async (req, res) => {
    const { cycle, week } = await getWeek(pool, req);
    res.json(present(cycle, week));
  });
  async function mutateWeek(req, kind, input, change) {
    return transaction(pool, async (db) => {
      const { cycle, week } = await getWeek(db, req, true);
      if (cycle.status !== "active")
        fail(409, "마친 주기의 기록은 읽기 전용이에요.");
      version(week.version, input.version);
      const before = structuredClone(week.state);
      change(week.state, cycle, week);
      const updated = (
        await db.query(
          "UPDATE weeks SET state=$1,version=version+1,updated_at=now() WHERE cycle_id=$2 AND number=$3 RETURNING *",
          [JSON.stringify(week.state), cycle.id, week.number],
        )
      ).rows[0];
      await audit(db, req, cycle, kind, {
        week: week.number,
        fromVersion: week.version,
        before,
        after: week.state,
      });
      return present(cycle, updated);
    });
  }
  const findOccurrence = (state, id) => {
    const o = state.occurrences.find((o) => o.id === id);
    if (!o) fail(404, "실행 항목을 찾을 수 없어요.");
    return o;
  };
  app.put(
    "/api/cycles/:cycleId/weeks/:week/occurrences/:occurrenceId/schedule",
    async (req, res) => {
      const input = scheduleInput.parse(req.body);
      const result = await mutateWeek(
        req,
        "schedule.updated",
        input,
        (state, cycle, week) => {
          const o = findOccurrence(state, req.params.occurrenceId);
          const start = weekStart(cycle.start_date, week.number);
          if (o.completed)
            fail(
              409,
              "실행 기록의 날짜를 바꾸기 전에 완료 기록을 정정해주세요.",
            );
          if (o.requiredDate && input.date !== o.requiredDate)
            fail(409, "매일 해야 하는 실행은 다른 날짜로 옮길 수 없어요.");
          if (
            input.date &&
            (input.date < start || input.date > addDays(start, 6))
          )
            fail(400, "같은 주 안에서 날짜를 선택해주세요.");
          // Weekly tactics may move within the ongoing week; daily tactics remain on their required date.
          if (
            addDays(start, 6) < evaluationDate(now()) &&
            input.date !== o.date
          )
            fail(409, "지난주의 일정은 다른 날로 옮길 수 없어요.");
          if (input.date === null && o.date && start <= evaluationDate(now()))
            fail(
              409,
              "이번 주 항목을 일정에서 빼는 대신 같은 주의 실행 날짜를 선택해주세요.",
            );
          Object.assign(o, {
            date: input.date,
            time: input.time,
            minutes: input.minutes,
          });
        },
      );
      res.json(result);
    },
  );
  app.put(
    "/api/cycles/:cycleId/weeks/:week/occurrences/:occurrenceId/completion",
    async (req, res) => {
      const input = completeInput.parse(req.body);
      const result = await mutateWeek(
        req,
        "execution.updated",
        input,
        (state) => {
          const o = findOccurrence(state, req.params.occurrenceId);
          if (!o.date) fail(400, "실행 날짜를 먼저 배치해주세요.");
          if (input.completed) {
            const instant = new Date(input.executedAt ?? now());
            if (+instant > +now() + 60000)
              fail(400, "미래의 실행을 완료로 기록할 수 없어요.");
            if (evaluationDate(instant) !== o.date)
              fail(
                400,
                "실제 실행 시각이 계획한 평가 날짜와 달라요. 날짜와 시각을 확인해주세요.",
              );
            o.completed = true;
            o.executedAt = instant.toISOString();
          } else {
            o.completed = false;
            o.executedAt = null;
          }
        },
      );
      res.json(result);
    },
  );
  app.put("/api/cycles/:cycleId/weeks/:week/review", async (req, res) => {
    const input = reviewInput.parse(req.body);
    const result = await mutateWeek(req, "review.saved", input, (state) => {
      const allowed = new Set(weekGoals(state).map((g) => g.id));
      if (Object.keys(input.metrics).some((id) => !allowed.has(id)))
        fail(400, "이번 주 목표의 지표만 기록할 수 있어요.");
      state.review = {
        learned: input.learned,
        next: input.next,
        metrics: input.metrics,
      };
      state.reviewSavedAt = now().toISOString();
    });
    res.json(result);
  });
  app.get("/api/cycles/:cycleId/weeks/:week/calendar.ics", async (req, res) => {
    const { cycle, week } = await getWeek(pool, req);
    res
      .type("text/calendar")
      .attachment(`twelve-week-${week.number}.ics`)
      .send(calendar(cycle, week, now()));
  });
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "요청한 기능을 찾을 수 없어요." }),
  );
  app.use((error, req, res, next) => {
    if (error instanceof z.ZodError)
      return res.status(400).json({
        error: "입력 내용을 확인해주세요.",
        issues: error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    if (error.status)
      return res.status(error.status).json({ error: error.message });
    if (error.code === "23505")
      return res
        .status(409)
        .json({ error: "이미 저장된 항목이에요. 새로 불러와주세요." });
    console.error("[API error]", error.code ?? error.name);
    res
      .status(500)
      .json({ error: "저장소 연결을 확인하고 다시 시도해주세요." });
  });
  return app;
}
