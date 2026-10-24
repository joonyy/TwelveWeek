import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertAppleURL,
  appleFetch,
  parseAppleEvents,
} from "../server/apple-calendar.js";
const range = { start: "2026-10-18T19:00:00Z", end: "2026-10-25T19:00:00Z" };
const cal = { id: "study", name: "학습" };
const object = (data) => ({
  etag: '"one"',
  data: `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${data}\r\nEND:VCALENDAR\r\n`,
});
test("iCloud parsing retains all-day, floating KST, expanded recurring instances and cancellation", () => {
  const data = [
    "BEGIN:VEVENT\r\nUID:work\r\nDTSTART;TZID=Asia/Seoul:20261019T100000\r\nDTEND;TZID=Asia/Seoul:20261019T180000\r\nSUMMARY:근무\r\nEND:VEVENT",
    "BEGIN:VEVENT\r\nUID:day\r\nDTSTART;VALUE=DATE:20261020\r\nDTEND;VALUE=DATE:20261021\r\nTRANSP:TRANSPARENT\r\nEND:VEVENT",
    "BEGIN:VEVENT\r\nUID:repeat\r\nRECURRENCE-ID:20261021T010000Z\r\nDTSTART:20261021T010000Z\r\nDTEND:20261021T020000Z\r\nEND:VEVENT",
    "BEGIN:VEVENT\r\nUID:repeat\r\nRECURRENCE-ID:20261022T010000Z\r\nDTSTART:20261022T010000Z\r\nDTEND:20261022T020000Z\r\nEND:VEVENT",
    "BEGIN:VEVENT\r\nUID:cancelled\r\nSTATUS:CANCELLED\r\nDTSTART:20261023T010000Z\r\nEND:VEVENT",
  ].join("\r\n");
  const events = parseAppleEvents([object(data)], cal, range);
  assert.equal(events.length, 4);
  assert.equal(events[0].start, "2026-10-19T01:00:00.000Z");
  assert.equal(events[1].allDay, true);
  assert.equal(events[1].transparent, true);
  assert.equal(+new Date(events[1].end) - +new Date(events[1].start), 86400000);
  assert.notEqual(events[2].id, events[3].id);
  assert.throws(
    () =>
      parseAppleEvents(
        [
          object(
            "BEGIN:VEVENT\r\nUID:r\r\nDTSTART:20261019T010000Z\r\nDTEND:20261019T020000Z\r\nRRULE:FREQ=DAILY\r\nEND:VEVENT",
          ),
        ],
        cal,
        range,
      ),
    /반복 일정/,
  );
});
test("iCloud transport never follows credential-bearing requests to non-Apple hosts", async () => {
  assert.doesNotThrow(() =>
    assertAppleURL("https://p123-caldav.icloud.com/123/calendars/"),
  );
  for (const url of [
    "http://caldav.icloud.com/",
    "https://caldav.icloud.com.evil.example/",
    "https://evil.example/",
    "https://user@caldav.icloud.com/",
    "https://caldav.icloud.com:8443/",
  ])
    assert.throws(() => assertAppleURL(url));
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(null, {
      status: 302,
      headers: { location: "https://evil.example/steal" },
    });
  };
  try {
    await assert.rejects(
      appleFetch("https://caldav.icloud.com/", {
        headers: { authorization: "test-only" },
      }),
    );
    assert.equal(calls, 1);
    calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return calls === 1
        ? new Response(null, {
            status: 307,
            headers: { location: "https://p123-caldav.icloud.com/principal/" },
          })
        : new Response("calendar-data", { status: 200 });
    };
    const response = await appleFetch("https://caldav.icloud.com/");
    assert.equal(response.url, "https://p123-caldav.icloud.com/principal/");
    assert.equal(response.redirected, true);
    assert.equal(await response.text(), "calendar-data");
  } finally {
    globalThis.fetch = original;
  }
});
