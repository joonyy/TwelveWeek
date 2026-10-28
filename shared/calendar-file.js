import ICAL from "ical.js";
import { addDays, calendarInstant, hasScheduledTime } from "./domain.js";

const MAX_STEPS = 20000;
const fail = (message) => {
  throw new Error(message);
};
const localZones = ["Asia/Seoul", "Asia/Tokyo"];
const utcZones = ["UTC", "Etc/UTC", "GMT", "Z"];
const timeText = (value) =>
  new Date(value + 9 * 3600000).toISOString().slice(11, 16);

async function stableBlockId(value) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  const hex = [...new Uint8Array(bytes)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((parseInt(hex[16], 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function instant(time, component, property) {
  if (!time) fail("시작·종료 시각이 없는 일정이 있습니다.");
  const hint =
    component.getFirstProperty(property)?.getParameter("tzid") ||
    component.getFirstProperty("dtstart")?.getParameter("tzid");
  if (time.isDate || time.zone?.tzid === "floating") {
    if (hint && !localZones.includes(hint) && !utcZones.includes(hint))
      fail(
        `시간대 ${hint}의 정의를 확인할 수 없습니다. iCloud 연결로 불러오거나 시간대가 포함된 파일을 선택해주세요.`,
      );
    const clock = time.isDate
      ? `${time.toString().slice(0, 10)}T00:00:00`
      : time.toString().slice(0, 19);
    return +new Date(`${clock}${utcZones.includes(hint) ? "Z" : "+09:00"}`);
  }
  return +time.toJSDate();
}

// Parse only a selected evaluation week. Raw files stay in the browser; callers
// persist explicitly selected blocks through the ordinary, versioned plan API.
export async function parseCalendarFile(text, startDate) {
  if (
    typeof text !== "string" ||
    new TextEncoder().encode(text).length > 1024 * 1024
  )
    fail("1MB 이하의 .ics 캘린더 파일을 선택해주세요.");
  let calendar;
  try {
    calendar = new ICAL.Component(ICAL.parse(text));
  } catch {
    fail("캘린더 파일을 읽지 못했습니다. .ics 형식으로 다시 내보내주세요.");
  }
  if (calendar.name !== "vcalendar") fail(".ics 캘린더 파일을 선택해주세요.");
  if (calendar.getFirstPropertyValue("method") === "CANCEL")
    fail("취소 알림 파일은 시간표로 가져올 수 없습니다.");
  const components = calendar.getAllSubcomponents("vevent");
  if (components.length > 2000)
    fail("일정이 너무 많습니다. 가져올 캘린더를 나눠 내보내주세요.");
  const lower = +calendarInstant(startDate, "04:00"),
    upper = +calendarInstant(addDays(startDate, 7), "04:00");
  const groups = new Map(),
    events = new Map();
  for (const component of components) {
    const uid = component.getFirstPropertyValue("uid");
    if (!uid || String(uid).length > 2000)
      fail("식별자가 없거나 잘못된 일정이 있습니다.");
    for (const name of ["dtstart", "dtend", "recurrence-id"]) {
      const property = component.getFirstProperty(name);
      const zone = property?.getParameter("tzid");
      if (
        zone &&
        !localZones.includes(zone) &&
        !utcZones.includes(zone) &&
        !calendar.getTimeZoneByID(zone)
      )
        fail(
          `시간대 ${zone}의 정의가 파일에 없습니다. iCloud 연결을 이용해주세요.`,
        );
    }
    if (component.getFirstProperty("recurrence-id")?.getParameter("range"))
      fail("‘이후 모든 반복’ 변경이 있는 파일은 iCloud 연결로 불러와주세요.");
    for (const property of component.getAllProperties("rrule"))
      if (
        !["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(
          property.getFirstValue().freq,
        )
      )
        fail(
          "시간·분·초 단위 반복은 파일로 가져올 수 없습니다. iCloud 연결을 이용해주세요.",
        );
    if (!groups.has(uid)) groups.set(uid, []);
    groups.get(uid).push(component);
  }
  function collect(item, start, end, identity) {
    if (item.component.getFirstPropertyValue("status") === "CANCELLED") return;
    const from = instant(start, item.component, "dtstart"),
      to = instant(end, item.component, "dtend");
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from)
      fail("일정의 시작·종료 시각을 확인할 수 없습니다.");
    if (from >= upper || to <= lower) return;
    if (events.size >= 500 && !events.has(identity))
      fail("해당 주의 일정이 너무 많습니다. 캘린더를 나눠 선택해주세요.");
    events.set(identity, {
      key: identity,
      title: (item.summary || "제목 없는 일정").slice(0, 6000),
      start: from,
      end: to,
      allDay: start.isDate,
    });
  }
  let steps = 0;
  for (const [uid, items] of groups) {
    const masters = items.filter((c) => !c.hasProperty("recurrence-id"));
    const exceptions = items.filter((c) => c.hasProperty("recurrence-id"));
    if (masters.length > 1)
      fail(
        "같은 식별자의 원본 일정이 중복되어 있습니다. 캘린더별로 파일을 내보내주세요.",
      );
    const master = masters[0];
    if (master && master.getFirstPropertyValue("status") !== "CANCELLED") {
      const event = new ICAL.Event(master, { exceptions });
      if (!event.startDate) fail("시작 시각이 없는 일정이 있습니다.");
      if (event.isRecurring()) {
        const iterator = event.iterator();
        while (true) {
          if (++steps > MAX_STEPS)
            fail(
              "반복 일정의 범위가 너무 큽니다. iCloud 연결을 이용하거나 파일의 기간을 줄여주세요.",
            );
          const next = iterator.next();
          if (!next || instant(next, master, "dtstart") >= upper) break;
          const detail = event.getOccurrenceDetails(next);
          collect(
            detail.item,
            detail.startDate,
            detail.endDate,
            `${uid}\n${next.toString()}`,
          );
        }
      } else collect(event, event.startDate, event.endDate, `${uid}\nsingle`);
    }
    // Detached/moved exceptions can enter the week from a later recurrence date.
    if (!master || master.getFirstPropertyValue("status") !== "CANCELLED")
      for (const component of exceptions) {
        if (component.getFirstPropertyValue("status") === "CANCELLED") continue;
        const event = new ICAL.Event(component, { exceptions: [] });
        collect(
          event,
          event.startDate,
          event.endDate,
          `${uid}\n${event.recurrenceId.toString()}`,
        );
      }
  }
  const output = [];
  for (const event of [...events.values()].sort(
    (a, b) => a.start - b.start || a.key.localeCompare(b.key),
  )) {
    const blocks = [];
    let cursor = Math.max(lower, event.start),
      end = Math.min(upper, event.end),
      invalid = false;
    while (cursor < end) {
      const day = Math.floor((cursor - lower) / 86400000);
      const stop = Math.min(
        end,
        lower + (day + 1) * 86400000,
        cursor + 720 * 60000,
      );
      const minutes = (stop - cursor) / 60000;
      if (!Number.isInteger(minutes) || minutes < 5) {
        invalid = true;
        break;
      }
      blocks.push({
        id: await stableBlockId(`${event.key}\n${cursor}`),
        day,
        time: timeText(cursor),
        minutes,
        kind: "fixed",
        title: event.title,
      });
      cursor = stop;
    }
    output.push({
      ...event,
      blocks: invalid ? [] : blocks,
      warning:
        invalid || !blocks.length
          ? "5분 미만이거나 분 단위가 아닌 일정은 시간표에 넣을 수 없어요."
          : "",
    });
  }
  return output;
}

export function calendarImportConflicts(blocks, existing, occurrences, dates) {
  const toWindow = (block) => {
    const start = +calendarInstant(addDays(dates[0], block.day), block.time);
    return {
      id: block.id,
      start,
      end: start + block.minutes * 60000,
      title: block.title,
    };
  };
  const windows = [
    ...existing.map(toWindow),
    ...occurrences
      .filter(hasScheduledTime)
      .map((o) => ({
        id: o.id,
        start: +calendarInstant(o.date, o.time),
        end: +calendarInstant(o.date, o.time) + o.minutes * 60000,
        title: "배치한 실행",
      })),
    ...blocks.map(toWindow),
  ];
  return blocks.flatMap((block) => {
    const value = toWindow(block);
    return windows
      .filter(
        (other) =>
          other.id !== value.id &&
          value.start < other.end &&
          other.start < value.end,
      )
      .map((other) => other.title);
  });
}
