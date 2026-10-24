import { parseAppleEvents, calendarError } from "../server/apple-calendar.js";
export function mockCalendarProvider() {
  const state = {
    calls: 0,
    failAt: 0,
    events: [
      {
        id: "work-event",
        uid: "work",
        calendarId: "work",
        calendarName: "직장",
        title: "OVS 근무",
        start: "2026-10-06T01:00:00Z",
        end: "2026-10-06T09:00:00Z",
        etag: "work-v1",
        transparent: false,
      },
    ],
  };
  const calendars = [
    { id: "study", name: "학습", readOnly: false },
    { id: "work", name: "직장", readOnly: false },
  ];
  return {
    state,
    provider: {
      calendars: async () => structuredClone(calendars),
      snapshot: async (credentials, ids, range) => ({
        calendars: structuredClone(calendars),
        events: structuredClone(
          state.events.filter(
            (e) =>
              ids.includes(e.calendarId) &&
              +new Date(e.start) < +new Date(range.end) &&
              +new Date(e.end) > +new Date(range.start),
          ),
        ),
      }),
      create: async (credentials, id, { uid, ics }) => {
        state.calls++;
        if (state.failAt === state.calls)
          throw calendarError(502, "일시 연결 실패 시험");
        if (state.events.some((e) => e.uid === uid && e.calendarId === id))
          throw calendarError(409, "같은 실행의 일정이 이미 있어요.");
        const events = parseAppleEvents(
          [{ data: ics, etag: `created-${state.calls}` }],
          calendars.find((c) => c.id === id),
          { start: "2026-01-01T00:00:00Z", end: "2027-12-31T00:00:00Z" },
        );
        state.events.push(...events);
        return {
          calendarId: id,
          eventId: events[0].id,
          title: events[0].title,
        };
      },
    },
  };
}
