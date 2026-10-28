import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCalendarFile,
  calendarImportConflicts,
} from "../shared/calendar-file.js";
import { calendarInstant, addDays } from "../shared/domain.js";
const calendar = (events, extra = "") =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${extra}${events}\r\nEND:VCALENDAR\r\n`;
const event = (uid, start, end, extra = "") =>
  `BEGIN:VEVENT\r\nUID:${uid}\r\nDTSTART${start}\r\nDTEND${end}\r\nSUMMARY:테스트 일정\r\n${extra}END:VEVENT`;

test("calendar files use KST floating times, preserve UTC instants and split overnight work at 04:00 with stable IDs", async () => {
  const source = calendar(
    event(
      "night",
      ";TZID=Asia/Seoul:20261020T230000",
      ";TZID=Asia/Seoul:20261021T050000",
    ) +
      "\r\n" +
      event("utc", ":20261022T010000Z", ":20261022T020000Z") +
      "\r\n" +
      event("outside", ":20261101T100000", ":20261101T110000"),
  );
  const events = await parseCalendarFile(source, "2026-10-19");
  assert.equal(events.length, 2);
  assert.deepEqual(
    events[0].blocks.map(({ day, time, minutes }) => ({ day, time, minutes })),
    [
      { day: 1, time: "23:00", minutes: 300 },
      { day: 2, time: "04:00", minutes: 60 },
    ],
  );
  assert.equal(events[1].blocks[0].time, "10:00");
  assert.deepEqual(
    (await parseCalendarFile(source, "2026-10-19")).map((e) => e.blocks),
    events.map((e) => e.blocks),
  );
  for (const block of events.flatMap((e) => e.blocks))
    assert.match(
      block.id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
});

test("recurrences respect exclusions, cancellations and moved exceptions including instances moved in from a later week", async () => {
  const source = calendar(
    [
      event(
        "daily",
        ":20261019T100000",
        ":20261019T110000",
        "RRULE:FREQ=DAILY;COUNT=7\r\nEXDATE:20261020T100000\r\n",
      ),
      event(
        "daily",
        ":20261021T100000",
        ":20261021T110000",
        "RECURRENCE-ID:20261021T100000\r\nSTATUS:CANCELLED\r\n",
      ),
      event(
        "daily",
        ":20261023T150000",
        ":20261023T160000",
        "RECURRENCE-ID:20261022T100000\r\n",
      ),
      event(
        "weekly",
        ":20261019T120000",
        ":20261019T130000",
        "RRULE:FREQ=WEEKLY;COUNT=2\r\n",
      ),
      event(
        "weekly",
        ":20261023T180000",
        ":20261023T190000",
        "RECURRENCE-ID:20261026T120000\r\n",
      ),
    ].join("\r\n"),
  );
  const events = await parseCalendarFile(source, "2026-10-19");
  assert.equal(events.length, 7);
  assert.equal(
    events.filter((e) => e.blocks[0].day === 1 || e.blocks[0].day === 2).length,
    0,
  );
  assert.equal(events.filter((e) => e.blocks[0].time === "15:00").length, 1);
  assert.equal(events.filter((e) => e.blocks[0].time === "18:00").length, 1);
});

test("inline timezone definitions and all-day events keep their true interval and calendar-day exclusivity", async () => {
  const zone =
    "BEGIN:VTIMEZONE\r\nTZID:Custom/Pacific\r\nBEGIN:STANDARD\r\nDTSTART:19700101T000000\r\nTZOFFSETFROM:-0800\r\nTZOFFSETTO:-0800\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\n";
  const events = await parseCalendarFile(
    calendar(
      event(
        "zoned",
        ";TZID=Custom/Pacific:20261019T100000",
        ";TZID=Custom/Pacific:20261019T110000",
      ) +
        "\r\n" +
        event("allday", ";VALUE=DATE:20261021", ";VALUE=DATE:20261022"),
      zone,
    ),
    "2026-10-19",
  );
  const zoned = events.find((e) => !e.allDay);
  assert.equal(zoned.blocks[0].time, "03:00");
  assert.equal(zoned.blocks[0].day, 0);
  const allDay = events.find((e) => e.allDay);
  assert.equal(allDay.end - allDay.start, 86400000);
  assert.equal(
    allDay.blocks.reduce((sum, b) => sum + b.minutes, 0),
    1440,
  );
  const lower = +calendarInstant("2026-10-19", "04:00"),
    upper = +calendarInstant("2026-10-26", "04:00");
  for (const block of events.flatMap((e) => e.blocks)) {
    const start = +calendarInstant(
      addDays("2026-10-19", block.day),
      block.time,
    );
    assert.ok(block.minutes <= 720);
    assert.ok(start >= lower && start + block.minutes * 60000 <= upper);
  }
});

test("unknown timezones, unsafe recurrence ranges, malformed files and excessive expansion fail explicitly", async () => {
  await assert.rejects(
    parseCalendarFile("invalid", "2026-10-19"),
    /캘린더 파일/,
  );
  await assert.rejects(
    parseCalendarFile("x".repeat(1024 * 1024 + 1), "2026-10-19"),
    /1MB/,
  );
  await assert.rejects(
    parseCalendarFile(
      calendar(
        event(
          "tz",
          ";TZID=Unknown/Zone:20261020T100000",
          ";TZID=Unknown/Zone:20261020T110000",
        ),
      ),
      "2026-10-19",
    ),
    /시간대/,
  );
  await assert.rejects(
    parseCalendarFile(
      calendar(
        event(
          "fast",
          ":20261020T100000",
          ":20261020T110000",
          "RRULE:FREQ=SECONDLY\r\n",
        ),
      ),
      "2026-10-19",
    ),
    /초 단위/,
  );
  await assert.rejects(
    parseCalendarFile(
      calendar(
        event(
          "old",
          ":19000101T100000",
          ":19000101T110000",
          "RRULE:FREQ=DAILY\r\n",
        ),
      ),
      "2026-10-19",
    ),
    /범위가 너무/,
  );
});

test("short or zero-length events are visible with a warning instead of silently creating a wrong-duration block", async () => {
  const events = await parseCalendarFile(
    calendar(event("short", ":20261020T100000", ":20261020T100100")),
    "2026-10-19",
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].blocks.length, 0);
  assert.match(events[0].warning, /5분/);
});

test("import conflict review includes prior-week overnight blocks, existing executions and selected events without self-conflicts", () => {
  const dates = Array.from({ length: 7 }, (_, i) => addDays("2026-10-19", i));
  const selected = [
    { id: "new", day: 0, time: "05:00", minutes: 60, title: "가져온 일정" },
  ];
  assert.deepEqual(calendarImportConflicts(selected, [], [], dates), []);
  assert.ok(
    calendarImportConflicts(
      selected,
      [
        {
          id: "previous",
          day: -1,
          time: "23:00",
          minutes: 480,
          title: "전주 야간근무",
        },
      ],
      [],
      dates,
    ).includes("전주 야간근무"),
  );
  assert.ok(
    calendarImportConflicts(
      selected,
      [],
      [{ id: "run", date: dates[0], time: "05:30", minutes: 30 }],
      dates,
    ).includes("배치한 실행"),
  );
  assert.ok(
    calendarImportConflicts(
      [
        ...selected,
        {
          id: "new2",
          day: 0,
          time: "05:30",
          minutes: 30,
          title: "두번째 일정",
        },
      ],
      [],
      [],
      dates,
    ).includes("두번째 일정"),
  );
});
