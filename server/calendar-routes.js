import { randomUUID } from "node:crypto";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { transaction } from "./db.js";
import { encryptKey, decryptKey } from "./ai-provider.js";
import { calendar } from "./calendar.js";
import {
  createAppleCalendarProvider,
  calendarError,
  digest,
} from "./apple-calendar.js";
import { addDays, prepareWeek, evaluationDate } from "../shared/domain.js";
import {
  calendarRange,
  placementRange,
  placementConflicts,
} from "../shared/calendar-plan.js";
import { dateSchema } from "./schema.js";

const baseInput = z.object({
  version: z.number().int().min(0),
  week: z.number().int().min(1).max(12),
  calendars: z.array(z.string().min(1).max(100)).min(1).max(30),
  target: z.string().min(1).max(100),
});
const placement = z
  .object({
    occurrenceId: z.string().min(1).max(100),
    date: dateSchema.nullable(),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    minutes: z.number().int().min(5).max(720),
    action: z.enum(["skip", "create", "link"]),
    linkId: z.string().max(200).optional(),
    allowOverlap: z.boolean(),
  })
  .strict();
const fingerprint = (events) =>
  digest([...events].sort((a, b) => a.id.localeCompare(b.id)));
const fail = (status, text) => {
  throw calendarError(status, text);
};

export function validateCalendarPlacements(
  state,
  placements,
  events,
  range,
  today,
) {
  if (
    placements.length !== state.occurrences.length ||
    new Set(placements.map((p) => p.occurrenceId)).size !== placements.length
  )
    fail(400, "실행 항목 목록이 달라요. 일정을 다시 불러와주세요.");
  for (const p of placements) {
    const o = state.occurrences.find((o) => o.id === p.occurrenceId);
    if (!o) fail(400, "계획에 없는 실행 항목이에요.");
    if (p.action === "skip") continue;
    if (!p.date || p.date < range.date || p.date > addDays(range.date, 6))
      fail(400, "같은 주 안에서 실행 날짜를 선택해주세요.");
    const window = placementRange(p);
    if (
      window.start < +new Date(range.start) ||
      window.end > +new Date(range.end)
    )
      fail(
        400,
        "선택한 주의 월요일 04:00부터 다음 월요일 04:00 안에 배치해주세요.",
      );
    if (o.requiredDate && p.date !== o.requiredDate)
      fail(409, "매일 해야 하는 실행은 다른 날짜로 옮길 수 없어요.");
    if (
      o.completed &&
      (p.date !== o.date || p.time !== o.time || p.minutes !== o.minutes)
    )
      fail(409, "완료한 실행의 시각은 이 화면에서 바꾸지 않습니다.");
    if (addDays(range.date, 6) < today && o.date !== p.date)
      fail(409, "지난주의 실행을 다른 날로 옮길 수 없어요.");
    if (p.action === "link") {
      const event = events.find((e) => e.id === p.linkId);
      if (
        !event ||
        window.start < +new Date(event.start) ||
        window.end > +new Date(event.end)
      )
        fail(409, "연결할 기존 일정의 시간 안에 실행을 배치해주세요.");
    }
  }
  const conflicts = placementConflicts(placements, events);
  if (
    placements.some(
      (p) =>
        p.action !== "skip" &&
        conflicts[p.occurrenceId].length &&
        !p.allowOverlap,
    )
  )
    fail(
      409,
      "겹치는 일정을 이동·연결하거나, 겹쳐 적용할 항목을 명시적으로 선택해주세요.",
    );
  return conflicts;
}

export function mountCalendarRoutes(
  app,
  {
    pool,
    now,
    owned,
    audit,
    rateLimits,
    provider = createAppleCalendarProvider(),
    env = process.env,
  },
) {
  const secret = () => env.CALENDAR_SECRETS_KEY || env.AI_SECRETS_KEY;
  const canConnect = () => !!secret() && secret().length >= 32;
  if (rateLimits)
    app.use(
      "/api/calendar",
      rateLimit({
        windowMs: 60000,
        limit: 60,
        standardHeaders: "draft-8",
        legacyHeaders: false,
      }),
    );
  const connection = async (db, req, lock = false) => {
    const row = (
      await db.query(
        `SELECT * FROM calendar_connections WHERE profile_id=$1${lock ? " FOR UPDATE" : ""}`,
        [req.profile.id],
      )
    ).rows[0];
    if (!row) fail(409, "먼저 iCloud 캘린더를 연결해주세요.");
    if (!canConnect())
      fail(503, "캘린더 연결을 위한 서버 암호화 설정이 필요해요.");
    return {
      row,
      credentials: {
        username: row.username,
        password: decryptKey(row.secret_cipher, secret()),
      },
    };
  };
  app.get("/api/calendar/apple", async (req, res) => {
    const c = (
      await pool.query(
        "SELECT username FROM calendar_connections WHERE profile_id=$1",
        [req.profile.id],
      )
    ).rows[0];
    res.json({
      connected: !!c,
      username: c?.username || "",
      canConnect: canConnect(),
    });
  });
  app.put("/api/calendar/apple", async (req, res) => {
    const input = z
      .object({
        username: z.string().trim().email().max(320),
        password: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9]{4}(?:-[A-Za-z0-9]{4}){3}$/),
      })
      .strict()
      .parse(req.body);
    if (!canConnect())
      fail(503, "캘린더 연결을 위한 서버 암호화 설정이 필요해요.");
    const calendars = await provider.calendars(input);
    await pool.query(
      "INSERT INTO calendar_connections(profile_id,username,secret_cipher) VALUES($1,$2,$3) ON CONFLICT(profile_id) DO UPDATE SET username=$2,secret_cipher=$3,updated_at=now()",
      [req.profile.id, input.username, encryptKey(input.password, secret())],
    );
    res.json({ connected: true, username: input.username, calendars });
  });
  app.delete("/api/calendar/apple", async (req, res) => {
    await transaction(pool, async (db) => {
      await db.query("SELECT id FROM profiles WHERE id=$1 FOR UPDATE", [
        req.profile.id,
      ]);
      await db.query("DELETE FROM calendar_connections WHERE profile_id=$1", [
        req.profile.id,
      ]);
      await db.query("DELETE FROM calendar_previews WHERE profile_id=$1", [
        req.profile.id,
      ]);
    });
    res.status(204).end();
  });
  app.get("/api/calendar/apple/calendars", async (req, res) => {
    const { credentials } = await connection(pool, req);
    res.json(await provider.calendars(credentials));
  });
  async function context(db, req, input, lock = false) {
    const c = await owned(db, req, lock);
    if (c.status === "complete")
      fail(409, "마친 주기는 캘린더에 새로 반영하지 않습니다.");
    if (c.version !== input.version)
      fail(409, "계획이 바뀌었어요. 저장한 최신 계획으로 다시 열어주세요.");
    if (input.week > c.week_count)
      fail(400, "실행 기간 안의 주차를 선택해주세요.");
    const week =
      c.status === "active"
        ? (
            await db.query(
              `SELECT * FROM weeks WHERE cycle_id=$1 AND number=$2${lock ? " FOR UPDATE" : ""}`,
              [c.id, input.week],
            )
          ).rows[0]
        : null;
    if (c.status === "active" && !week)
      fail(409, "확정된 주간 실행 항목을 찾지 못했어요.");
    const state = week?.state || prepareWeek(c.plan, c.start_date, input.week);
    if (state.occurrences.length > 600)
      fail(
        400,
        "실행 항목이 너무 많아요. 주간 계획의 범위를 먼저 검토해주세요.",
      );
    const { row, credentials } = await connection(db, req, lock);
    const range = calendarRange(c.start_date, input.week);
    const ids = [...new Set([...input.calendars, input.target])].sort();
    const snapshot = await provider.snapshot(credentials, ids, range);
    const target = snapshot.calendars.find((x) => x.id === input.target);
    if (!target || target.readOnly)
      fail(409, "새 일정을 반영할 수 있는 캘린더를 선택해주세요.");
    return { c, week, state, row, credentials, range, ids, snapshot, target };
  }
  const prefix = "/api/calendar/cycles/:cycleId";
  const ensureNewEvents = (x, input) => {
    for (const p of input.placements.filter((p) => p.action === "create")) {
      const uid = `${x.c.id}-${input.week}-${p.occurrenceId}@twelve.local`;
      if (
        x.snapshot.events.some(
          (e) => e.calendarId === input.target && e.uid === uid,
        )
      )
        fail(
          409,
          "같은 실행의 Apple 일정이 이미 있어요. 새로 만들기 대신 기존 일정에 연결해주세요.",
        );
    }
  };
  app.post(`${prefix}/context`, async (req, res) => {
    const input = baseInput.strict().parse(req.body);
    const x = await context(pool, req, input);
    res.json({
      version: x.c.version,
      weekVersion: x.week?.version ?? null,
      state: x.state,
      range: x.range,
      events: x.snapshot.events,
      fingerprint: fingerprint(x.snapshot.events),
      target: x.target,
    });
  });
  app.post(`${prefix}/preview`, async (req, res) => {
    const input = baseInput
      .extend({
        fingerprint: z.string().length(64),
        weekVersion: z.number().int().min(0).nullable(),
        placements: z.array(placement).max(600),
      })
      .strict()
      .parse(req.body);
    const x = await context(pool, req, input);
    if (
      input.fingerprint !== fingerprint(x.snapshot.events) ||
      input.weekVersion !== (x.week?.version ?? null)
    )
      fail(
        409,
        "기존 일정이나 주간 배치가 바뀌었어요. 다시 불러와 비교해주세요.",
      );
    if (!input.placements.some((p) => p.action !== "skip"))
      fail(400, "반영할 실행 항목을 하나 이상 선택해주세요.");
    validateCalendarPlacements(
      x.state,
      input.placements,
      x.snapshot.events,
      x.range,
      evaluationDate(now()),
    );
    ensureNewEvents(x, input);
    const id = randomUUID(),
      expiresAt = new Date(+now() + 15 * 60000).toISOString();
    const payload = {
      input,
      connection: digest(x.row.secret_cipher),
      events: x.snapshot.events,
    };
    await pool.query("DELETE FROM calendar_previews WHERE expires_at<$1", [
      now(),
    ]);
    await pool.query(
      "INSERT INTO calendar_previews(id,profile_id,cycle_id,payload,expires_at) VALUES($1,$2,$3,$4,$5)",
      [id, req.profile.id, x.c.id, JSON.stringify(payload), expiresAt],
    );
    res.json({
      id,
      expiresAt,
      placements: input.placements,
      create: input.placements.filter((p) => p.action === "create").length,
      link: input.placements.filter((p) => p.action === "link").length,
      target: x.target,
    });
  });
  app.post(`${prefix}/previews/:previewId/apply`, async (req, res) => {
    z.object({ confirmed: z.literal(true) })
      .strict()
      .parse(req.body);
    const result = await transaction(pool, async (db) => {
      // Lock the cycle and connection before any remote write. Repeated requests
      // replay the stored result rather than creating another batch.
      await db.query("SELECT id FROM profiles WHERE id=$1 FOR UPDATE", [
        req.profile.id,
      ]);
      const initial = await owned(db, req, true);
      const preview = (
        await db.query(
          "SELECT * FROM calendar_previews WHERE id=$1 AND profile_id=$2 AND cycle_id=$3 FOR UPDATE",
          [z.uuid().parse(req.params.previewId), req.profile.id, initial.id],
        )
      ).rows[0];
      if (!preview) fail(404, "검토한 적용 내용을 찾을 수 없어요.");
      if (preview.result)
        return {
          ...preview.result,
          ...(preview.result.ok ? { cycle: initial } : {}),
          replayed: true,
        };
      if (+new Date(preview.expires_at) <= +now())
        fail(409, "검토 시간이 지났어요. 기존 일정을 다시 불러와주세요.");
      const { input } = preview.payload;
      const x = await context(db, req, input, true);
      if (
        digest(x.row.secret_cipher) !== preview.payload.connection ||
        fingerprint(x.snapshot.events) !== input.fingerprint ||
        (x.week?.version ?? null) !== input.weekVersion
      )
        fail(
          409,
          "연결·기존 일정·실행 배치가 바뀌었어요. 새로 비교한 뒤 적용해주세요.",
        );
      validateCalendarPlacements(
        x.state,
        input.placements,
        x.snapshot.events,
        x.range,
        evaluationDate(now()),
      );
      ensureNewEvents(x, input);
      const applied = [];
      try {
        for (const p of input.placements.filter((p) => p.action !== "skip")) {
          const o = x.state.occurrences.find((o) => o.id === p.occurrenceId);
          const t = x.state.tactics.find((t) => t.id === o.tacticId);
          let calendarLink;
          if (p.action === "link") {
            const event = x.snapshot.events.find((e) => e.id === p.linkId);
            calendarLink = {
              calendarId: event.calendarId,
              eventId: event.id,
              title: event.title,
            };
          } else {
            const uid = `${x.c.id}-${input.week}-${o.id}@twelve.local`;
            await provider.create(x.credentials, input.target, {
              uid,
              ics: calendar(
                x.c,
                {
                  number: input.week,
                  version: x.week?.version ?? x.c.version,
                  state: {
                    tactics: [t],
                    occurrences: [{ ...o, ...p, timePlaced: true }],
                  },
                },
                now(),
              ),
            });
            calendarLink = {
              calendarId: input.target,
              eventId: digest([input.target, uid, "single"]),
              title: t.title,
            };
          }
          applied.push({
            occurrenceId: o.id,
            date: p.date,
            time: p.time,
            minutes: p.minutes,
            calendarLink,
            action: p.action,
          });
        }
      } catch (e) {
        const partial = {
          ok: false,
          partial: true,
          applied,
          message: e.calendarPublic
            ? e.message
            : "Apple Calendar 반영 중 연결이 끊겼어요. 기존 일정을 다시 불러와 결과를 확인해주세요.",
        };
        await db.query("UPDATE calendar_previews SET result=$1 WHERE id=$2", [
          JSON.stringify(partial),
          preview.id,
        ]);
        await audit(db, req, x.c, "calendar.partial", {
          week: input.week,
          applied: applied.map((p) => p.occurrenceId),
        });
        return partial;
      }
      const plan = structuredClone(x.c.plan);
      const previous = (
        plan.weeklySchedules?.find((w) => w.week === input.week)?.placements ||
        []
      ).filter((p) => x.state.occurrences.some((o) => o.id === p.occurrenceId));
      const placements = [
        ...previous.filter(
          (p) => !applied.some((a) => a.occurrenceId === p.occurrenceId),
        ),
        ...applied.map(({ action, ...p }) => p),
      ];
      plan.weeklySchedules = [
        ...(plan.weeklySchedules || []).filter((w) => w.week !== input.week),
        { week: input.week, placements },
      ].sort((a, b) => a.week - b.week);
      if (x.week) {
        const state = structuredClone(x.state);
        for (const p of applied) {
          delete state.occurrences.find((o) => o.id === p.occurrenceId)
            .timePlaced;
          Object.assign(
            state.occurrences.find((o) => o.id === p.occurrenceId),
            {
              date: p.date,
              time: p.time,
              minutes: p.minutes,
              calendarLink: p.calendarLink,
            },
          );
        }
        await db.query(
          "UPDATE weeks SET state=$1,version=version+1,updated_at=now() WHERE cycle_id=$2 AND number=$3",
          [JSON.stringify(state), x.c.id, input.week],
        );
      }
      const fresh = (
        await db.query(
          "UPDATE cycles SET plan=$1,version=version+1,updated_at=now() WHERE id=$2 RETURNING *",
          [JSON.stringify(plan), x.c.id],
        )
      ).rows[0];
      const result = {
        ok: true,
        cycle: fresh,
        applied,
        created: applied.filter((p) => p.action === "create").length,
        linked: applied.filter((p) => p.action === "link").length,
      };
      await db.query("UPDATE calendar_previews SET result=$1 WHERE id=$2", [
        JSON.stringify(result),
        preview.id,
      ]);
      await audit(db, req, x.c, "calendar.applied", {
        week: input.week,
        created: result.created,
        linked: result.linked,
        occurrences: applied.map((p) => p.occurrenceId),
      });
      return result;
    });
    res.json(result);
  });
}
