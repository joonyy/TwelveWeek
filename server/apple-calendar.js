import { createHash } from "node:crypto";
import { DAVClient } from "tsdav";
import ICAL from "ical.js";

export const digest = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
export const calendarError = (status, message) =>
  Object.assign(new Error(message), { status, calendarPublic: true });

export function assertAppleURL(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !/^(?:p\d+-)?caldav\.icloud\.com$/.test(url.hostname) ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  )
    throw calendarError(502, "iCloud 캘린더 서버 주소를 확인하지 못했어요.");
  return url;
}
export async function appleFetch(input, init = {}) {
  let url = assertAppleURL(
    typeof input === "string" || input instanceof URL ? input : input.url,
  );
  for (let redirects = 0; redirects <= 5; redirects++) {
    const res = await fetch(url, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
    });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get("location");
      await res.body?.cancel();
      if (!location) break;
      url = assertAppleURL(new URL(location, url));
      continue;
    }
    const reader = res.body?.getReader();
    const chunks = [];
    let size = 0;
    if (reader)
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 10 * 1024 * 1024) {
          await reader.cancel();
          throw calendarError(
            502,
            "일정 응답이 너무 커요. 비교할 캘린더를 줄여주세요.",
          );
        }
        chunks.push(Buffer.from(value));
      }
    const bounded = new Response(
      [204, 205, 304].includes(res.status) ? null : Buffer.concat(chunks),
      { status: res.status, statusText: res.statusText, headers: res.headers },
    );
    Object.defineProperties(bounded, {
      url: { value: url.href },
      redirected: { value: redirects > 0 },
    });
    return bounded;
  }
  throw calendarError(502, "iCloud 캘린더 서버 연결을 완료하지 못했어요.");
}

// CalDAV expand returns concrete recurrence instances. Never treat an unexpanded
// recurrence, invalid timezone or truncated response as an empty/free calendar.
export function parseAppleEvents(objects, calendar, range) {
  const output = [];
  for (const object of objects) {
    if (typeof object.data !== "string")
      throw calendarError(502, "일정 내용을 읽지 못했어요.");
    const component = new ICAL.Component(ICAL.parse(object.data));
    for (const c of component.getAllSubcomponents("vevent")) {
      if (c.getFirstPropertyValue("status") === "CANCELLED") continue;
      if (c.hasProperty("rrule") || c.hasProperty("rdate"))
        throw calendarError(
          502,
          "반복 일정을 개별 날짜로 펼치지 못했어요. 비교가 완료되기 전에는 적용할 수 없습니다.",
        );
      const event = new ICAL.Event(c);
      if (!event.uid || !event.startDate)
        throw calendarError(502, "일정의 식별자나 시작 시각이 없어요.");
      const instant = (time, propName) => {
        const prop = c.getFirstProperty(propName);
        const zone = prop?.getParameter("tzid");
        if (time.isDate || time.zone?.tzid === "floating") {
          if (zone && !["Asia/Seoul", "Asia/Tokyo"].includes(zone))
            throw calendarError(502, "시간대가 확인되지 않은 일정이 있어요.");
          return new Date(
            `${time.toString().slice(0, 10)}T${time.isDate ? "00:00:00" : time.toString().slice(11, 19)}+09:00`,
          );
        }
        return time.toJSDate();
      };
      const start = instant(event.startDate, "dtstart");
      let end = instant(event.endDate, "dtend");
      if (event.startDate.isDate && +end === +start)
        end = new Date(+start + 86400000);
      if (!Number.isFinite(+start) || !Number.isFinite(+end) || +end < +start)
        throw calendarError(502, "일정의 시작·종료 시각을 확인하지 못했어요.");
      if (+start >= +new Date(range.end) || +end <= +new Date(range.start))
        continue;
      const id = digest([
        calendar.id,
        event.uid,
        c.getFirstPropertyValue("recurrence-id")?.toString() || "single",
      ]);
      output.push({
        id,
        uid: event.uid,
        calendarId: calendar.id,
        calendarName: calendar.name,
        title: (event.summary || "제목 없는 일정").slice(0, 6000),
        start: start.toISOString(),
        end: end.toISOString(),
        allDay: event.startDate.isDate,
        transparent:
          c.getFirstPropertyValue("transp") === "TRANSPARENT" ||
          +start === +end,
        etag: object.etag || digest(object.data),
      });
    }
  }
  return output;
}

export function createAppleCalendarProvider() {
  async function session(credentials) {
    const client = new DAVClient({
      serverUrl: "https://caldav.icloud.com",
      credentials,
      authMethod: "Basic",
      defaultAccountType: "caldav",
      fetch: appleFetch,
    });
    await client.login({ loadCollections: false, loadObjects: false });
    const calendars = (
      await client.fetchCalendars({
        props: {
          "d:displayname": {},
          "ca:calendar-color": {},
          "d:current-user-privilege-set": {},
        },
        projectedProps: { currentUserPrivilegeSet: true },
      })
    )
      .filter((c) => !c.components?.length || c.components.includes("VEVENT"))
      .map((c) => {
        assertAppleURL(c.url);
        const privileges = c.projectedProps?.currentUserPrivilegeSet;
        return {
          ...c,
          id: digest(c.url),
          name:
            typeof c.displayName === "string"
              ? c.displayName
              : "이름 없는 캘린더",
          readOnly:
            !!privileges &&
            !/"(?:write|bind|all)"/.test(JSON.stringify(privileges)),
        };
      });
    return { client, calendars };
  }
  async function safe(fn) {
    try {
      return await fn();
    } catch (e) {
      if (e.calendarPublic) throw e;
      throw calendarError(
        502,
        "iCloud 캘린더 연결에 실패했어요. 계정·앱 전용 암호와 연결 상태를 확인해주세요.",
      );
    }
  }
  return {
    calendars: (credentials) =>
      safe(async () =>
        (await session(credentials)).calendars.map(
          ({ id, name, readOnly }) => ({ id, name, readOnly }),
        ),
      ),
    snapshot: (credentials, ids, range) =>
      safe(async () => {
        const { client, calendars } = await session(credentials);
        const selected = ids.map((id) => calendars.find((c) => c.id === id));
        if (selected.some((c) => !c))
          throw calendarError(
            409,
            "캘린더 목록이 바뀌었어요. 다시 연결해 선택해주세요.",
          );
        const events = [];
        for (const c of selected) {
          const objects = await client.fetchCalendarObjects({
            calendar: c,
            timeRange: { start: range.start, end: range.end },
            expand: true,
            urlFilter: () => true,
          });
          events.push(...parseAppleEvents(objects, c, range));
          if (events.length > 3000)
            throw calendarError(
              502,
              "비교할 일정이 너무 많아요. 캘린더를 줄여주세요.",
            );
        }
        return {
          calendars: calendars.map(({ id, name, readOnly }) => ({
            id,
            name,
            readOnly,
          })),
          events: events.sort((a, b) => a.id.localeCompare(b.id)),
        };
      }),
    create: (credentials, calendarId, { uid, ics }) =>
      safe(async () => {
        const { client, calendars } = await session(credentials);
        const c = calendars.find((c) => c.id === calendarId);
        if (!c || c.readOnly)
          throw calendarError(409, "반영할 캘린더에 새 일정을 만들 수 없어요.");
        const filename = `${digest(uid)}.ics`;
        const res = await client.createCalendarObject({
          calendar: c,
          filename,
          iCalString: ics,
          headers: { "If-None-Match": "*" },
        });
        if (!res.ok)
          throw calendarError(
            res.status === 412 ? 409 : 502,
            res.status === 412
              ? "같은 실행의 일정이 이미 있어요. 기존 일정을 다시 불러와 연결해주세요."
              : "Apple Calendar에 새 일정을 만들지 못했어요.",
          );
        return {
          calendarId,
          eventId: digest([calendarId, uid, "single"]),
          title: "",
        };
      }),
  };
}
