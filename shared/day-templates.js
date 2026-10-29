import {
  addDays,
  daysBetween,
  calendarInstant,
  hasScheduledTime,
} from "./domain.js";
import {
  calendarOffset,
  timeAtOffset,
  modelWeekFor,
  withWeekModel,
} from "./planning.js";
const uid = () => crypto.randomUUID();
export const DAY_BLOCK_KINDS = {
  fixed: "근무·고정 일정",
  strategy: "집중 작업",
  buffer: "작은 업무",
  breakout: "식사·휴식",
};
export function templateFromDay(blocks, day, name) {
  return {
    id: uid(),
    name,
    blocks: blocks
      .filter((b) => b.day === day)
      .map((b) => ({
        id: uid(),
        title: b.title,
        time: b.time,
        minutes: b.minutes,
        kind: b.kind,
      })),
  };
}
export function workDuration(start, end) {
  const clock = (t) => +t.slice(0, 2) * 60 + +t.slice(3);
  return (clock(end) - clock(start) + 1440) % 1440;
}
// One timing resolver for both the visual editor and date application.
// start is measured from 04:00 and can cross into an adjacent evaluation day.
export function dayTemplateTimeline(template, { workTime, workMinutes } = {}) {
  const work = template.blocks.find((b) => b.id === template.workBlockId);
  const workStart = calendarOffset(workTime || work?.time || "09:00");
  const length = workMinutes ?? work?.minutes ?? 60;
  return template.blocks.map((original) => {
    const anchor = original.anchor || "clock";
    let start = calendarOffset(original.time),
      minutes = original.minutes;
    if (original.id === work?.id) {
      start = workStart;
      minutes = length;
    } else if (work && anchor !== "clock") {
      start =
        workStart +
        (anchor === "work-end" ? length : 0) +
        (original.offset || 0);
    }
    return { ...original, start, minutes };
  });
}
export function instantiateDayTemplate(
  template,
  date,
  { startDate, weekCount, today, workTime, workMinutes } = {},
) {
  const blocks = [],
    issues = [];
  const work = template.blocks.find((b) => b.id === template.workBlockId);
  const length = workMinutes ?? work?.minutes ?? 60;
  if (work && (!Number.isInteger(length) || length < 5 || length > 720))
    return {
      blocks,
      issues: [
        {
          title: work.title,
          message: "근무 길이는 5분~12시간으로 정해주세요.",
        },
      ],
      invalid: true,
    };
  for (const original of dayTemplateTimeline(template, {
    workTime,
    workMinutes,
  })) {
    const offset = original.start,
      minutes = original.minutes;
    const dayShift = Math.floor(offset / 1440),
      actualDate = addDays(date, dayShift);
    const index = daysBetween(startDate, actualDate),
      week = Math.floor(index / 7) + 1;
    if (index < 0 || index >= weekCount * 7 || (today && actualDate < today)) {
      issues.push({
        title: original.title,
        message: `${actualDate}은 적용 가능한 날짜 밖입니다. 이 블록은 추가하지 않습니다.`,
      });
      continue;
    }
    blocks.push({
      week,
      date: actualDate,
      block: {
        id: uid(),
        day: index % 7,
        time: timeAtOffset(((offset % 1440) + 1440) % 1440),
        minutes,
        kind: original.kind,
        title: original.title,
        templateOrigin: { date, templateId: template.id },
      },
    });
  }
  return { blocks, issues, invalid: false };
}
export function templateReplacementCandidates(
  plan,
  date,
  startDate,
  weekCount,
  today,
) {
  const result = [];
  for (let week = 1; week <= weekCount; week++)
    for (const block of modelWeekFor(plan, week)) {
      const actualDate = addDays(startDate, (week - 1) * 7 + block.day);
      if (
        (!today || actualDate >= today) &&
        (actualDate === date || block.templateOrigin?.date === date)
      )
        result.push({
          key: `${week}:${block.id}`,
          week,
          date: actualDate,
          block,
        });
    }
  return result;
}
export function planWithDayTemplate(plan, generated, removeKeys) {
  const next = structuredClone(plan),
    weeks = new Set(generated.map((item) => item.week));
  for (const key of removeKeys) weeks.add(+key.split(":")[0]);
  let result = next;
  for (const week of weeks) {
    const blocks = modelWeekFor(plan, week).filter(
      (b) => !removeKeys.includes(`${week}:${b.id}`),
    );
    blocks.push(
      ...generated
        .filter((item) => item.week === week)
        .map((item) => item.block),
    );
    if (blocks.length > 100)
      throw new Error(
        `${week}주차의 블록이 100개를 넘습니다. 교체할 블록이나 템플릿을 조정해주세요.`,
      );
    result = withWeekModel(result, week, blocks);
  }
  return result;
}
export function templateConflicts(
  plan,
  generated,
  occurrences,
  startDate,
  weekCount,
) {
  const window = (date, block, key) => {
    const start = +calendarInstant(date, block.time);
    return {
      key,
      date,
      title: block.title,
      start,
      end: start + block.minutes * 60000,
    };
  };
  const existing = [];
  for (let week = 0; week <= weekCount; week++)
    for (const block of modelWeekFor(plan, week)) {
      if (
        week === 0 &&
        !(block.day === 6 && calendarOffset(block.time) + block.minutes > 1440)
      )
        continue;
      existing.push(
        window(
          addDays(startDate, (week - 1) * 7 + block.day),
          block,
          `${week}:${block.id}`,
        ),
      );
    }
  for (const item of occurrences)
    if (hasScheduledTime(item))
      existing.push(
        window(
          item.date,
          { ...item, title: item.title || "배치한 전술 실행" },
          item.id,
        ),
      );
  const added = generated.map((item) =>
    window(item.date, item.block, `${item.week}:${item.block.id}`),
  );
  const seen = new Set(),
    conflicts = [];
  for (const value of added)
    for (const other of existing) {
      const key = [value.key, other.key].sort().join("|");
      if (
        value.key === other.key ||
        seen.has(key) ||
        value.start >= other.end ||
        other.start >= value.end
      )
        continue;
      seen.add(key);
      conflicts.push({
        key,
        date: value.date,
        title: value.title,
        other: other.title,
      });
    }
  // Existing already includes newly generated blocks in the proposed plan.
  return conflicts.filter((c) => c.title && c.other);
}
