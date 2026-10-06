import { z } from "zod";
import { dateOnly, MAX_WEEK_COUNT } from "../shared/domain.js";
const text = z.string().max(6000);
const id = z.uuid();
export const dateSchema = z.string().refine((v) => {
  try {
    return dateOnly(v);
  } catch {
    return false;
  }
}, "날짜를 확인해주세요.");
const tactic = z.object({
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
  tactics: z.array(tactic).max(50),
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
export const planSchema = z
  .object({
    longVision: text,
    personalVision: text,
    careerVision: text,
    visionModes: z
      .object({
        longVision: z.enum(["list", "text"]),
        personalVision: z.enum(["list", "text"]),
        careerVision: z.enum(["list", "text"]),
      })
      .optional(),
    goals: z.array(goal).max(50),
    modelWeek: z
      .array(
        z.object({
          id,
          day: z.number().int().min(0).max(6),
          time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
          minutes: z.number().int().min(5).max(720),
          kind: z.enum(["strategy", "buffer", "breakout"]),
          title: text,
        }),
      )
      .max(100),
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
