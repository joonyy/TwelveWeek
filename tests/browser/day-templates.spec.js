import { test, expect } from "@playwright/test";
import { emptyPlan } from "../../shared/domain.js";
import { templateFromDay } from "../../shared/day-templates.js";
test.use({ locale: "ko-KR" });
async function setup(
  page,
  request,
  name,
  { templates = true, mode = "plan", view = "week" } = {},
) {
  const root = "http://127.0.0.1:4111/api";
  const profile = await (
    await request.post(`${root}/profiles`, {
      data: { name, password: "test-password" },
    })
  ).json();
  const { token } = await (
    await request.post(`${root}/sessions`, {
      data: { profileId: profile.id, password: "test-password" },
    })
  ).json();
  const headers = { Authorization: `Bearer ${token}` },
    plan = emptyPlan(2);
  plan.goals[0].title = "실행 보존";
  Object.assign(plan.goals[0].tactics[0], {
    title: "학습 실행",
    condition: "설명 한 번",
    count: 2,
    weeks: [1, 2],
  });
  const block = (title, time, minutes, kind, day = 2) => ({
    id: crypto.randomUUID(),
    title,
    time,
    minutes,
    kind,
    day,
  });
  plan.modelWeek = [
    block("맥날 근무", "19:00", 360, "fixed"),
    block("산책", "18:30", 30, "breakout"),
    block("러닝", "01:00", 30, "strategy"),
    block("고정 약속", "10:30", 60, "fixed"),
    block("기존 일요일 근무", "15:00", 480, "fixed", 6),
  ];
  if (templates) {
    const t = templateFromDay(plan.modelWeek, 2, "근무 있는 평일");
    t.workBlockId = t.blocks[0].id;
    Object.assign(t.blocks[1], { anchor: "work-start", offset: -30 });
    Object.assign(t.blocks[2], { anchor: "work-end", offset: 0 });
    plan.dayTemplates = [t];
  }
  let cycle = await (
    await request.post(`${root}/cycles`, {
      headers,
      data: { title: name, startDate: "2026-10-05", weekCount: 2, plan },
    })
  ).json();
  cycle = await (
    await request.post(`${root}/cycles/${cycle.id}/start`, {
      headers,
      data: { version: cycle.version },
    })
  ).json();
  const call = (method, path, data) =>
    request[method](`${root}/cycles/${cycle.id}${path}`, {
      headers,
      ...(data ? { data } : {}),
    });
  const getWeek = async (n) => (await call("get", `/weeks/${n}`)).json();
  const getCycle = async () => (await call("get", "")).json();
  let w = await getWeek(1),
    o = w.state.occurrences[0];
  w = await (
    await call("put", `/weeks/1/occurrences/${o.id}/schedule`, {
      version: w.version,
      date: "2026-10-07",
      time: "10:00",
      minutes: 60,
    })
  ).json();
  const completion = await call(
    "put",
    `/weeks/1/occurrences/${o.id}/completion`,
    { version: w.version, completed: true },
  );
  expect(completion.ok()).toBe(true);
  let next = await getWeek(2);
  const scheduled = await call(
    "put",
    `/weeks/2/occurrences/${next.state.occurrences[0].id}/schedule`,
    { version: next.version, date: "2026-10-12", time: "07:15", minutes: 60 },
  );
  expect(scheduled.ok()).toBe(true);
  await page.clock.setFixedTime(new Date("2026-10-07T12:00:00+09:00"));
  await page.addInitScript(
    (value) => localStorage.setItem("twelve.token", value),
    token,
  );
  const hash = `/#cycle=${cycle.id}&view=${view}&week=1&mode=${mode}&tab=3`;
  await page.goto(hash);
  return { call, getWeek, getCycle, plan, hash };
}
const open = async (page) => {
  await expect(
    page.getByRole("region", { name: "주차별 모범 주간 조정" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "하루 템플릿 적용", exact: true })
    .click();
  return page.getByRole("dialog", { name: "하루 템플릿으로 시간표 구성" });
};

test("keep the weekly editor, copy a day into a reusable template, link work anchors, save and reopen on mobile", async ({
  page,
  request,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const { getCycle, getWeek, plan } = await setup(
    page,
    request,
    "하루 원형 작성",
    { templates: false, view: "plan" },
  );
  const before = await getWeek(1);
  const mode = page.getByRole("group", { name: "모범 주간 구성 방식" });
  await expect(
    mode.getByRole("button", { name: "요일별 주간형" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("region", { name: "모범 주간 캘린더" }),
  ).toBeVisible();
  await mode.getByRole("button", { name: "하루 유형 조합형" }).click();
  const lib = page.getByRole("region", { name: "하루 템플릿 보관함" });
  await lib
    .getByLabel("새 하루 템플릿 이름", { exact: true })
    .fill("근무 있는 평일");
  await lib.getByLabel("템플릿 원본 하루").selectOption("2");
  await lib.getByRole("button", { name: "이 하루로 템플릿 만들기" }).click();
  await expect(lib.getByRole("article")).toHaveCount(4);
  await lib
    .getByLabel("기준 근무 블록")
    .selectOption({ label: "맥날 근무 · 19:00" });
  await lib
    .getByLabel("활동 시각 기준 2", { exact: true })
    .selectOption("work-start");
  await lib.getByLabel("기준 간격 2", { exact: true }).fill("-30");
  await lib
    .getByLabel("활동 시각 기준 3", { exact: true })
    .selectOption("work-end");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("저장");
  await page.reload();
  await expect(
    mode.getByRole("button", { name: "하루 유형 조합형" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(lib.getByLabel("기준 간격 2", { exact: true })).toHaveValue(
    "-30",
  );
  const saved = await getCycle();
  expect(saved.plan.modelWeek).toEqual(plan.modelWeek);
  expect((await getWeek(1)).state).toEqual(before.state);
  await lib.screenshot({
    path: "test-results/day-template-library-desktop-ko.png",
  });
  await page.setViewportSize({ width: 1024, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await lib.screenshot({
    path: "test-results/day-template-library-mobile.png",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  // Switching back keeps both templates and the original weekly editor.
  await mode.getByRole("button", { name: "요일별 주간형" }).click();
  await expect(
    page.getByRole("region", { name: "모범 주간 캘린더" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("apply a Sunday night template across two weeks, review conflicts and keep execution records and defaults", async ({
  page,
  request,
}) => {
  const { getCycle, getWeek, plan } = await setup(
    page,
    request,
    "하루 원형 적용",
  );
  const before = [await getWeek(1), await getWeek(2)];
  const dialog = await open(page);
  await dialog.getByLabel("템플릿 적용 날짜").selectOption("2026-10-11");
  await dialog.getByLabel("실제 출근 시각", { exact: true }).fill("23:00");
  await dialog.getByLabel("실제 퇴근 시각", { exact: true }).fill("07:00");
  const preview = dialog.getByRole("region", { name: "템플릿 적용 미리보기" });
  await expect(preview).toContainText(
    "2026-10-12 · 07:00 · 러닝 · 30분 · 2주차",
  );
  await expect(preview).toContainText("22:30 · 산책");
  await expect(preview).toContainText("10:30 · 고정 약속");
  const apply = dialog.getByRole("button", {
    name: "2026-10-11에 템플릿 적용",
    exact: true,
  });
  await expect(apply).toBeDisabled();
  await expect(
    dialog.getByRole("region", { name: "템플릿 일정 겹침" }),
  ).toContainText("학습 실행");
  await dialog
    .getByRole("checkbox", {
      name: "교체할 블록과 추가되지 않는 항목을 확인했습니다.",
    })
    .check();
  await expect(apply).toBeDisabled();
  await dialog
    .getByRole("checkbox", { name: "겹침을 확인했으며 함께 배치합니다." })
    .check();
  await expect(apply).toBeEnabled();
  await dialog.screenshot({
    path: "test-results/day-template-apply-preview.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await apply.click();
  await expect(dialog).toHaveCount(0);
  const saved = await getCycle();
  expect(saved.plan.modelWeek).toEqual(plan.modelWeek);
  expect(saved.plan.weeklyModelWeeks).toHaveLength(2);
  const spill = saved.plan.weeklyModelWeeks
    .find((w) => w.week === 2)
    .blocks.find((b) => b.title === "러닝" && b.templateOrigin);
  expect(spill).toMatchObject({
    day: 0,
    time: "07:00",
    minutes: 30,
    templateOrigin: { date: "2026-10-11" },
  });
  for (const [index, old] of before.entries()) {
    const fresh = await getWeek(index + 1);
    expect(fresh.state).toEqual(old.state);
    expect(fresh.score).toEqual(old.score);
  }
  await page.reload();
  await page.getByLabel("주차 선택").selectOption("2");
  await expect(
    page.getByRole("button", {
      name: "러닝 · 월요일 07:00 · 30분",
      exact: true,
    }),
  ).toHaveCount(1);
});

test("stale saves and an older API preserve the preview and template edits without overwriting records", async ({
  page,
  request,
}) => {
  const { call, getCycle, getWeek } = await setup(
    page,
    request,
    "하루 원형 저장 충돌",
  );
  const before = await getWeek(1),
    c = await getCycle();
  const dialog = await open(page);
  await dialog.getByLabel("실제 출근 시각", { exact: true }).fill("22:00");
  await dialog
    .getByRole("checkbox", {
      name: "교체할 블록과 추가되지 않는 항목을 확인했습니다.",
    })
    .check();
  await dialog
    .getByRole("checkbox", { name: "겹침을 확인했으며 함께 배치합니다." })
    .check();
  const updated = await call("put", "", {
    version: c.version,
    title: "다른 창 변경",
    startDate: c.start_date,
    weekCount: 2,
    plan: c.plan,
  });
  expect(updated.ok()).toBe(true);
  await dialog
    .getByRole("button", { name: "2026-10-07에 템플릿 적용", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("다른 화면");
  await expect(
    dialog.getByLabel("실제 출근 시각", { exact: true }),
  ).toHaveValue("22:00");
  expect((await getCycle()).plan).toEqual(c.plan);
  expect((await getWeek(1)).state).toEqual(before.state);
  await dialog
    .getByRole("button", { name: "템플릿 관리", exact: true })
    .click();
  await dialog
    .getByLabel("하루 템플릿 이름", { exact: true })
    .fill("업데이트 중에도 남는 입력");
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { ok: true } }),
  );
  await dialog
    .getByRole("button", { name: "템플릿 보관함 저장", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("업데이트 중");
  await expect(
    dialog.getByLabel("하루 템플릿 이름", { exact: true }),
  ).toHaveValue("업데이트 중에도 남는 입력");
  expect((await getCycle()).plan).toEqual(c.plan);
});
