import { z } from "zod";
import { dateOnly, MAX_WEEK_COUNT } from "../shared/domain.js";
const text = z.string().max(6000);
const id = z.uuid();
const visionArea = z.enum(["personalVision", "careerVision"]);
export const dateSchema = z.string().refine((v) => {
  try {
    return dateOnly(v);
  } catch {
    return false;
  }
}, "날짜를 확인해주세요.");
export const tacticSchema = z.object({
  id,
  title: text,
  condition: text,

  kind: z.enum(["weekly", "daily", "once"]),
  count: z.number().int().min(1).max(50),
  weeks: z
    .array(z.number().int().min(1).max(12))
    .max(12)
    .refine((v) => new Set(v).size === v.length),
});
const goal = z.object({
  id,
  title: text,
  success: text,
  benefit: text,
  leading: text,
  lagging: text,
  measurement: text,

  visionLinks: z
    .array(z.object({ area: visionArea, itemId: id, text }))
    .max(6001)
    .refine(
      (links) =>
        new Set(links.map((link) => `${link.area}:${link.itemId}`)).size ===
        links.length,
      "같은 비전 항목을 중복 연결할 수 없습니다.",
    )
    .optional(),
  tactics: z.array(tacticSchema).max(50),
  difficulties: z
    .array(
      z.object({
        id,
        tacticId: z.string().max(100),
        obstacle: text,
        response: text,
      }),
    )
    .max(50),
});
const modelWeekBlocks = z
  .array(
    z.object({
      id,
      day: z.number().int().min(0).max(6),
      time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      minutes: z.number().int().min(5).max(720),
      kind: z.enum(["strategy", "buffer", "breakout", "fixed"]),
      title: text,
    }),
  )
  .max(100)
  .refine(
    (items) => new Set(items.map((b) => b.id)).size === items.length,
    "시간 블록 ID는 중복될 수 없습니다.",
  );
export const planSchema = z
  .object({
    longVision: text,
    personalVision: text,
    careerVision: text,
    visionItems: z
      .object({
        personalVision: z.array(z.object({ id, text })).max(6001),
        careerVision: z.array(z.object({ id, text })).max(6001),
      })
      .optional(),
    visionModes: z
      .object({
        longVision: z.enum(["list", "text"]),
        personalVision: z.enum(["list", "text"]),
        careerVision: z.enum(["list", "text"]),
      })
      .optional(),
    goals: z.array(goal).max(50),
    modelWeek: modelWeekBlocks,
    weeklyModelWeeks: z
      .array(
        z.object({
          week: z.number().int().min(1).max(12),
          blocks: modelWeekBlocks,
        }),
      )
      .max(12)
      .refine(
        (items) => new Set(items.map((w) => w.week)).size === items.length,
        "주차별 모범 주간은 중복될 수 없습니다.",
      )
      .optional(),
    modelWeekNotes: text.optional(),
    weeklySchedules: z
      .array(
        z.object({
          week: z.number().int().min(1).max(12),
          placements: z
            .array(
              z.object({
                occurrenceId: z.string().min(1).max(100),
                date: dateSchema,
                time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
                minutes: z.number().int().min(5).max(720),
                calendarLink: z
                  .object({
                    calendarId: z.string().max(100),
                    eventId: z.string().max(200),
                    title: text,
                  })
                  .optional(),
              }),
            )
            .max(600)
            .refine(
              (items) =>
                new Set(items.map((p) => p.occurrenceId)).size === items.length,
              "같은 실행 항목의 배치는 중복될 수 없습니다.",
            ),
        }),
      )
      .max(12)
      .refine(
        (items) => new Set(items.map((w) => w.week)).size === items.length,
        "같은 주차의 배치는 중복될 수 없습니다.",
      )
      .optional(),
    responsibility: text,
    responsibilityActions: z
      .object({ personal: text, business: text })
      .optional(),
    pastCommitments: z
      .array(z.object({ promise: text, action: text, benefit: text }))
      .length(2),
    commitments: z
      .array(
        z.object({
          id,
          area: text,
          promise: text,
          action: text,
          cost: text,
          choice: text,
          accepted: z.boolean().optional(),
        }),
      )
      .max(150),
  })
  .superRefine((p, ctx) => {
    if (p.visionItems) {
      const ids = Object.values(p.visionItems)
        .flat()
        .map((item) => item.id);
      if (new Set(ids).size !== ids.length)
        ctx.addIssue({
          code: "custom",
          message: "비전 항목 ID는 서로 달라야 합니다.",
        });
      for (const area of ["personalVision", "careerVision"])
        if (p.visionItems[area].map((item) => item.text).join("\n") !== p[area])
          ctx.addIssue({
            code: "custom",
            path: ["visionItems", area],
            message: "비전 내용과 항목이 일치하지 않습니다.",
          });
    }
    const ids = [
      ...p.goals.map((g) => g.id),
      ...p.goals.flatMap((g) => g.tactics.map((t) => t.id)),
    ];
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({
        code: "custom",
        message: "목표와 전술 ID는 서로 달라야 합니다.",
      });
  });
export const cycleInput = z.object({
  title: z.string().trim().min(1).max(120),
  startDate: dateSchema,
  weekCount: z.number().int().min(1).max(MAX_WEEK_COUNT).optional(),
  plan: planSchema,
  version: z.number().int().min(0),
});
export const scheduleInput = z.object({
  version: z.number().int().min(0),
  date: dateSchema.nullable(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  minutes: z.number().int().min(5).max(720),
  timePlaced: z.boolean().optional(),
});
export const completeInput = z.object({
  version: z.number().int().min(0),
  completed: z.boolean(),
  executedAt: z.iso.datetime({ offset: true }).optional(),
});

export const reviewInput = z.object({
  version: z.number().int().min(0),
  learned: text,
  next: text,
  metrics: z.record(z.string(), z.object({ leading: text, lagging: text })),
});
