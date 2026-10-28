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
  readingBook: z.string().trim().max(300).optional(),
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
  referenceUrl: z
    .string()
    .trim()
    .max(2000)
    .refine((value) => {
      if (!value) return true;
      try {
        return ["https:", "http:"].includes(new URL(value).protocol);
      } catch {
        return false;
      }
    }, "http 또는 https 기획서 링크를 입력해주세요.")
    .optional(),
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
const modelBlock = z.object({
  id,
  day: z.number().int().min(0).max(6),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  minutes: z.number().int().min(5).max(720),
  kind: z.enum(["strategy", "buffer", "breakout", "fixed"]),
  title: text,
  templateOrigin: z.object({ date: dateSchema, templateId: id }).optional(),
});
const modelWeekBlocks = z
  .array(modelBlock)
  .max(100)
  .refine(
    (items) => new Set(items.map((b) => b.id)).size === items.length,
    "시간 블록 ID는 중복될 수 없습니다.",
  );
const dayTemplate = z
  .object({
    id,
    name: z.string().trim().min(1).max(80),
    workBlockId: id.optional(),
    blocks: z
      .array(
        modelBlock.omit({ day: true, templateOrigin: true }).extend({
          anchor: z.enum(["clock", "work-start", "work-end"]).optional(),
          offset: z.number().int().min(-1440).max(1440).optional(),
        }),
      )
      .max(100),
  })
  .superRefine((template, ctx) => {
    const work = template.blocks.find((b) => b.id === template.workBlockId);
    if (
      new Set(template.blocks.map((b) => b.id)).size !== template.blocks.length
    )
      ctx.addIssue({
        code: "custom",
        message: "템플릿 블록 ID는 중복될 수 없습니다.",
      });
    if (
      template.workBlockId &&
      (!work ||
        work.kind !== "fixed" ||
        (work.anchor && work.anchor !== "clock"))
    )
      ctx.addIssue({
        code: "custom",
        message: "기준 근무는 고정 시각의 근무 블록이어야 합니다.",
      });
    for (const block of template.blocks)
      if (
        block.anchor &&
        block.anchor !== "clock" &&
        (!work || block.id === work.id || block.offset === undefined)
      )
        ctx.addIssue({
          code: "custom",
          message: "연결 활동에는 기준 근무와 간격(분)이 필요합니다.",
        });
  });
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
    modelWeekMode: z.enum(["week", "day"]).optional(),
    dayTemplates: z
      .array(dayTemplate)
      .max(20)
      .refine(
        (items) => new Set(items.map((t) => t.id)).size === items.length,
        "템플릿 ID는 중복될 수 없습니다.",
      )
      .optional(),
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
  readingRecord: z
    .object({
      book: z.string().trim().min(1).max(300),
      chapter: z.string().trim().min(1).max(300),
      thought: z.string().trim().min(1).max(2000),
    })
    .optional(),
});
export const readingRecordSchema = completeInput.shape.readingRecord.unwrap();
export const readingInput = z.object({
  version: z.number().int().min(0),
  record: readingRecordSchema.nullable(),
});
export const reviewInput = z.object({
  version: z.number().int().min(0),
  learned: text,
  next: text,
  metrics: z.record(z.string(), z.object({ leading: text, lagging: text })),
});
