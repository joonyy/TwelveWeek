import { test, expect } from "@playwright/test";
import { emptyPlan } from "../../shared/domain.js";

const file = (events) => ({
  name: "Mac.ics",
  mimeType: "text/calendar",
  buffer: Buffer.from(
    `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events}\r\nEND:VCALENDAR\r\n`,
  ),
});
const event = (uid, title, start, end) =>
  `BEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:${title}\r\nDTSTART:${start}\r\nDTEND:${end}\r\nEND:VEVENT`;
const fixture = file(
  [
    event("work", "학원 확정 근무", "20261006T100000", "20261006T150000"),
    event("night", "야간 근무", "20261008T230000", "20261009T070000"),
    event("outside", "다른 주 일정", "20261013T100000", "20261013T120000"),
  ].join("\r\n"),
);
async function setup(page, request, suffix) {
  const root = "http://127.0.0.1:4111/api";
  const profile = await (
    await request.post(`${root}/profiles`, {
      data: { name: `파일 가져오기 ${suffix}`, password: "test-password" },
    })
  ).json();
  const { token } = await (
    await request.post(`${root}/sessions`, {
      data: { profileId: profile.id, password: "test-password" },
    })
  ).json();
  const headers = { Authorization: `Bearer ${token}` };
  const plan = emptyPlan(2);
  plan.goals[0].title = "실행 기록 보존";
  Object.assign(plan.goals[0].tactics[0], {
    title: "한 줄 남기기",
    condition: "한 줄 저장",
    count: 2,
    weeks: [1, 2],
  });
  plan.modelWeek = [
    {
      id: crypto.randomUUID(),
      day: 1,
      time: "10:00",
      minutes: 480,
      kind: "fixed",
      title: "기존 OVS 근무",
    },
  ];
  let cycle = await (
    await request.post(`${root}/cycles`, {
      headers,
      data: {
        title: `가져오기 ${suffix}`,
        startDate: "2026-10-05",
        weekCount: 2,
        plan,
      },
    })
  ).json();
  cycle = await (
    await request.post(`${root}/cycles/${cycle.id}/start`, {
      headers,
      data: { version: cycle.version },
    })
  ).json();
  const getCycle = async () =>
    (await request.get(`${root}/cycles/${cycle.id}`, { headers })).json();
  const getWeek = async () =>
    (
      await request.get(`${root}/cycles/${cycle.id}/weeks/1`, { headers })
    ).json();
  await page.clock.setFixedTime(new Date("2026-10-07T12:00:00+09:00"));
  await page.addInitScript(
    (t) => localStorage.setItem("twelve.token", t),
    token,
  );
  await page.goto(`/#cycle=${cycle.id}&view=week&week=1&mode=plan`);
  await expect(
    page.getByRole("region", { name: "주차별 모범 주간 조정" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "캘린더 가져오기", exact: true })
    .click();
  return {
    root,
    headers,
    getCycle,
    getWeek,
    dialog: page.getByRole("dialog", { name: "1주차 캘린더 가져오기" }),
  };
}

test("calendar file import previews overlaps, preserves executions and defaults, and skips duplicate imports", async ({
  page,
  request,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const { getCycle, getWeek, dialog } = await setup(page, request, "저장");
  const before = await getCycle(),
    weekBefore = await getWeek();
  await dialog
    .getByLabel("캘린더 파일(.ics)", { exact: true })
    .setInputFiles(fixture);
  const choices = dialog.getByRole("group", { name: "가져올 일정 선택" });
  await expect(choices.getByRole("checkbox")).toHaveCount(2);
  await expect(choices).not.toContainText("다른 주 일정");
  const apply = dialog.getByRole("button", {
    name: "선택한 일정 2개를 1주차에 추가",
  });
  await expect(apply).toBeDisabled();
  expect((await getCycle()).version).toBe(before.version);
  await dialog
    .getByRole("checkbox", {
      name: "겹침을 확인했으며 기존 일정과 함께 배치합니다.",
    })
    .check();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await apply.click();
  await expect(dialog).toHaveCount(0);
  const after = await getCycle();
  expect(after.plan.modelWeek).toEqual(before.plan.modelWeek);
  expect(after.plan.goals).toEqual(before.plan.goals);
  expect(after.plan.weeklyModelWeeks).toHaveLength(1);
  expect(after.plan.weeklyModelWeeks[0].week).toBe(1);
  expect(after.plan.weeklyModelWeeks[0].blocks).toHaveLength(4); // original + work + two overnight fragments
  expect((await getWeek()).state).toEqual(weekBefore.state);
  expect((await getWeek()).score).toEqual(weekBefore.score);
  await page.getByRole("button", { name: "주간 일정", exact: true }).click();
  await page
    .getByRole("button", { name: "캘린더 가져오기", exact: true })
    .click();
  await dialog
    .getByLabel("캘린더 파일(.ics)", { exact: true })
    .setInputFiles(fixture);
  await expect(
    dialog.getByText("이미 가져온 일정", { exact: true }),
  ).toHaveCount(2);
  await expect(
    dialog.getByRole("button", { name: "선택한 일정 0개를 1주차에 추가" }),
  ).toBeDisabled();
  await dialog
    .getByRole("button", { name: "iCloud 연결", exact: true })
    .click();
  await expect(dialog.getByLabel("Apple 계정 이메일")).toBeVisible();
  expect(errors).toEqual([]);
});

test("calendar import keeps preview on stale revision and refuses malformed files without writing", async ({
  page,
  request,
}) => {
  const { root, headers, getCycle, dialog } = await setup(
    page,
    request,
    "충돌",
  );
  const before = await getCycle();
  await dialog.getByLabel("캘린더 파일(.ics)", { exact: true }).setInputFiles({
    name: "bad.ics",
    mimeType: "text/calendar",
    buffer: Buffer.from("bad"),
  });
  await expect(dialog.getByRole("alert")).toContainText("읽지 못했습니다");
  expect((await getCycle()).version).toBe(before.version);
  await dialog
    .getByLabel("캘린더 파일(.ics)", { exact: true })
    .setInputFiles(fixture);
  await dialog
    .getByRole("checkbox", {
      name: "겹침을 확인했으며 기존 일정과 함께 배치합니다.",
    })
    .check();
  const updated = await request.put(`${root}/cycles/${before.id}`, {
    headers,
    data: {
      version: before.version,
      title: "다른 창에서 수정",
      startDate: before.start_date,
      weekCount: before.week_count,
      plan: before.plan,
    },
  });
  expect(updated.ok()).toBe(true);
  await dialog
    .getByRole("button", { name: "선택한 일정 2개를 1주차에 추가" })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(
    dialog
      .getByRole("group", { name: "가져올 일정 선택" })
      .getByRole("checkbox", { checked: true }),
  ).toHaveCount(2);
  expect((await getCycle()).plan).toEqual(before.plan);
});
