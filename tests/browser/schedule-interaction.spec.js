import { test, expect } from "@playwright/test";
import { emptyPlan } from "../../shared/domain.js";
import { readFile } from "node:fs/promises";
import ICAL from "ical.js";

async function setup(page, request, name, customize = () => {}) {
  const base = "http://127.0.0.1:4111/api";
  const profile = await (
    await request.post(`${base}/profiles`, { data: { name } })
  ).json();
  const { token } = await (
    await request.post(`${base}/sessions`, { data: { profileId: profile.id } })
  ).json();
  const headers = { Authorization: `Bearer ${token}` };
  const plan = emptyPlan(2);
  const goal = plan.goals[0];
  goal.title = "집중해서 결과 남기기";
  Object.assign(goal.tactics[0], {
    title: "학습 결과 정리",
    condition: "설명과 초안 저장",
    count: 3,
    weeks: [1, 2],
  });
  goal.tactics.push({
    id: crypto.randomUUID(),
    title: "일일 기록",
    condition: "한 줄 기록",
    kind: "daily",
    count: 1,
    weeks: [1, 2],
  });
  plan.modelWeek = [
    {
      id: crypto.randomUUID(),
      day: 0,
      time: "19:00",
      minutes: 360,
      kind: "fixed",
      title: "맥날 근무",
    },
    {
      id: crypto.randomUUID(),
      day: 2,
      time: "09:00",
      minutes: 120,
      kind: "strategy",
      title: "모범 집중 블록",
    },
    {
      id: crypto.randomUUID(),
      day: 6,
      time: "01:00",
      minutes: 30,
      kind: "fixed",
      title: "주간 평가 · 30분",
    },
  ];
  customize(plan);
  let cycle = await (
    await request.post(`${base}/cycles`, {
      headers,
      data: { title: name, startDate: "2026-10-05", weekCount: 2, plan },
    })
  ).json();
  const starting = await request.post(`${base}/cycles/${cycle.id}/start`, {
    headers,
    data: { version: cycle.version },
  });
  expect(starting.ok()).toBe(true);
  await page.clock.setFixedTime(new Date("2026-10-07T12:00:00+09:00"));
  await page.addInitScript(
    (value) => localStorage.setItem("twelve.token", value),
    token,
  );
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await expect(
    page.getByRole("button", { name: "주간 일정", exact: true }),
  ).toBeVisible();
  const getWeek = async (number = 1) =>
    (
      await request.get(`${base}/cycles/${cycle.id}/weeks/${number}`, {
        headers,
      })
    ).json();
  const getCycle = async () =>
    (await request.get(`${base}/cycles/${cycle.id}`, { headers })).json();
  const updatePlan = async (change) => {
    const current = await getCycle();
    const plan = structuredClone(current.plan);
    change(plan);
    const response = await request.put(`${base}/cycles/${cycle.id}`, {
      headers,
      data: {
        version: current.version,
        title: current.title,
        startDate: current.start_date,
        weekCount: current.week_count,
        plan,
      },
    });
    expect(response.ok()).toBe(true);
    return response.json();
  };
  return { getWeek, getCycle, updatePlan };
}
async function dragHandle(page, handle, delta, cancel = false) {
  await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox();
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + delta, { steps: 6 });
  if (cancel) await page.keyboard.press("Escape");
  await page.mouse.up();
}
async function dragClock(page, wheel, from, to, cancel = false) {
  const svg = wheel.locator("svg.daily-clock");
  await svg.scrollIntoViewIfNeeded();
  const box = await svg.boundingBox();
  const offset = (time) => {
    const [h, m] = time.split(":").map(Number);
    return ((h + 20) % 24) * 60 + m;
  };
  const origin = offset(from),
    distance = offset(to) - origin;
  const point = (minutes) => {
    const angle = (minutes / 1440) * Math.PI * 2 - Math.PI / 2;
    return [
      box.x + (box.width * (200 + 123 * Math.cos(angle))) / 400,
      box.y + (box.height * (200 + 123 * Math.sin(angle))) / 400,
    ];
  };
  await page.mouse.move(...point(origin));
  await page.mouse.down();
  for (let i = 1; i <= 8; i++)
    await page.mouse.move(...point(origin + (distance * i) / 8));
  if (cancel) await page.keyboard.press("Escape");
  await page.mouse.up();
}
async function resizeClock(
  page,
  wheel,
  title,
  edge,
  delta,
  { cancel = false, touch = false } = {},
) {
  await wheel.locator("svg.daily-clock").scrollIntoViewIfNeeded();
  const handle = wheel.getByRole("button", {
    name: `${title} ${edge === "start" ? "시작" : "종료"} 시간 조절`,
    exact: true,
  });
  await handle.scrollIntoViewIfNeeded();
  const svg = await wheel.locator("svg.daily-clock").boundingBox();
  const box = await handle.boundingBox(),
    x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  const cx = svg.x + svg.width / 2,
    cy = svg.y + svg.height / 2;
  const radius = Math.hypot(x - cx, y - cy),
    anchor = Math.atan2(y - cy, x - cx);
  const at = (i) => ({
    x: cx + radius * Math.cos(anchor + ((delta / 1440) * Math.PI * 2 * i) / 8),
    y: cy + radius * Math.sin(anchor + ((delta / 1440) * Math.PI * 2 * i) / 8),
  });
  if (touch) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 1,
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    for (let i = 1; i <= 8; i++)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [at(i)],
      });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await cdp.detach();
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      const p = at(i);
      await page.mouse.move(p.x, p.y);
    }
    if (cancel) await page.keyboard.press("Escape");
    await page.mouse.up();
  }
}
test("daily clock resizes each edge independently, preserves scores, undoes and shares the saved duration", async ({
  page,
  request,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1100 });
  const f = await setup(
    page,
    request,
    `원형 길이 ${crypto.randomUUID().slice(0, 8)}`,
  );
  const cycle = await f.getCycle(),
    future = await f.getWeek(2);
  const wheel = page.getByRole("region", { name: "하루 원형 시간표" });
  const arc = (time, minutes) =>
    wheel.getByRole("button", {
      name: `학습 결과 정리 · ${time} · ${minutes}분 일정 선택`,
      exact: true,
    });
  const edge = (which) =>
    wheel.getByRole("button", {
      name: `학습 결과 정리 ${which} 시간 조절`,
      exact: true,
    });
  await wheel
    .getByRole("button", { name: "11:00 실행 배치", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", {
      name: "학습 결과 정리 1회차 이 시간에 배치",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(arc("11:00", 60)).toBeVisible();
  const before = await f.getWeek();
  await arc("11:00", 60).click();
  await expect(edge("시작")).toBeVisible();
  await expect(edge("종료")).toBeVisible();
  await edge("종료").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await f.getWeek()).toEqual(before);
  await resizeClock(page, wheel, "학습 결과 정리", "end", 60);
  await expect(arc("11:00", 120)).toBeVisible();
  await resizeClock(page, wheel, "학습 결과 정리", "end", -30);
  await expect(arc("11:00", 90)).toBeVisible();
  await resizeClock(page, wheel, "학습 결과 정리", "start", -30);
  await expect(arc("10:30", 120)).toBeVisible();
  await resizeClock(page, wheel, "학습 결과 정리", "start", 60);
  await expect(arc("11:30", 60)).toBeVisible();
  await expect(edge("시작")).toBeFocused();
  await page.keyboard.press("Meta+z");
  await expect(arc("10:30", 120)).toBeVisible();
  await expect(
    wheel.getByRole("button", { name: "실행 배치 다시 실행", exact: true }),
  ).toBeEnabled();
  await expect(wheel).toBeFocused();
  await page.keyboard.press("Meta+Shift+z");
  await expect(arc("11:30", 60)).toBeVisible();
  await edge("종료").focus();
  await page.keyboard.press("ArrowRight");
  await expect(arc("11:30", 90)).toBeVisible();
  await expect(edge("종료")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(arc("11:30", 60)).toBeVisible();
  const saved = await f.getWeek();
  expect(saved.state.tactics).toEqual(before.state.tactics);
  expect(saved.state.occurrences).toHaveLength(before.state.occurrences.length);
  expect(saved.daily).toEqual(before.daily);
  expect(saved.score).toEqual(before.score);
  await resizeClock(page, wheel, "학습 결과 정리", "end", 90, { cancel: true });
  await expect(arc("11:30", 60)).toBeVisible();
  expect(await f.getWeek()).toEqual(saved);
  await arc("11:30", 60).click();
  await page.route("**/occurrences/*/schedule", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "길이 저장 실패" }),
    }),
  );
  await resizeClock(page, wheel, "학습 결과 정리", "end", 30);
  await expect(page.getByText("길이 저장 실패", { exact: true })).toBeVisible();
  await expect(arc("11:30", 60)).toBeVisible();
  expect(await f.getWeek()).toEqual(saved);
  await page.unroute("**/occurrences/*/schedule");
  await page.getByRole("button", { name: "주간 일정", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "이번 주 일정 캘린더" })
      .getByRole("button", {
        name: "학습 결과 정리 · 수요일 11:30 · 60분",
        exact: true,
      }),
  ).toBeVisible();
  expect(await f.getCycle()).toEqual(cycle);
  expect(await f.getWeek(2)).toEqual(future);
  await page
    .getByRole("button", { name: "일간 실행 · 10분", exact: true })
    .click();
  await page.reload();
  await expect(arc("11:30", 60)).toBeVisible();
  await arc("11:30", 60).click();
  await page
    .getByRole("button", { name: "학습 결과 정리 완료", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "학습 결과 정리 완료 취소", exact: true }),
  ).toBeEnabled();
  await expect(edge("시작")).toHaveCount(0);
  await expect(edge("종료")).toHaveCount(0);
  expect(errors).toEqual([]);
});
test("daily clock touch resizing keeps daily dates and exposes only the real endpoint of a 04:00 continuation", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const f = await setup(
    page,
    request,
    `원형 터치 ${crypto.randomUUID().slice(0, 8)}`,
  );
  const wheel = page.getByRole("region", { name: "하루 원형 시간표" });
  const daily = (time, minutes) =>
    wheel.getByRole("button", {
      name: `일일 기록 · ${time} · ${minutes}분 일정 선택`,
      exact: true,
    });
  await daily("09:00", 60).click();
  const before = await f.getWeek();
  await resizeClock(page, wheel, "일일 기록", "start", -30, { touch: true });
  await expect(daily("08:30", 90)).toBeVisible();
  await resizeClock(page, wheel, "일일 기록", "end", 30, { touch: true });
  await expect(daily("08:30", 120)).toBeVisible();
  const resized = await f.getWeek();
  expect(
    resized.state.occurrences.find((o) => o.requiredDate === "2026-10-07"),
  ).toMatchObject({ date: "2026-10-07", time: "08:30", minutes: 120 });
  expect(resized.daily).toEqual(before.daily);
  expect(resized.score).toEqual(before.score);
  await page.getByRole("button", { name: "주간 일정", exact: true }).click();
  await page
    .locator(".unscheduled")
    .getByRole("button", { name: /학습 결과 정리.*1회차/ })
    .click();
  await page.getByLabel("평가 날짜").fill("2026-10-07");
  await page.getByLabel("시작 시각", { exact: true }).fill("03:00");
  await page.getByLabel("예상 시간(분)").fill("120");
  await page.getByRole("button", { name: "일정 저장", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "일간 실행 · 10분", exact: true })
    .click();
  await wheel
    .getByRole("button", {
      name: "학습 결과 정리 · 03:00 · 120분 일정 선택",
      exact: true,
    })
    .click();
  await expect(
    wheel.getByRole("button", {
      name: "학습 결과 정리 시작 시간 조절",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    wheel.getByRole("button", {
      name: "학습 결과 정리 종료 시간 조절",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.locator(".day-strip button").nth(3).click();
  await wheel
    .getByRole("button", {
      name: "학습 결과 정리 · 04:00부터 · 120분 일정 선택",
      exact: true,
    })
    .click();
  await expect(
    wheel.getByRole("button", {
      name: "학습 결과 정리 시작 시간 조절",
      exact: true,
    }),
  ).toHaveCount(0);
  await resizeClock(page, wheel, "학습 결과 정리", "end", 30, { touch: true });
  await expect(
    wheel.getByRole("button", {
      name: "학습 결과 정리 · 04:00부터 · 150분 일정 선택",
      exact: true,
    }),
  ).toBeVisible();
  const after = await f.getWeek();
  expect(after.state.occurrences[0]).toMatchObject({
    date: "2026-10-07",
    time: "03:00",
    minutes: 150,
  });
  await wheel.screenshot({
    path: "test-results/daily-clock-resize-mobile.png",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("daily clock selects, deletes time only, undoes, edits, drags and shares saved placement with the weekly view", async ({
  page,
  request,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1100 });
  const f = await setup(
    page,
    request,
    `일간 달력 단축키 ${crypto.randomUUID().slice(0, 8)}`,
  );
  const cycle = await f.getCycle(),
    future = await f.getWeek(2);
  const wheel = page.getByRole("region", { name: "하루 원형 시간표" });
  const arc = (time, minutes = 60) =>
    wheel.getByRole("button", {
      name: `학습 결과 정리 · ${time} · ${minutes}분 일정 선택`,
      exact: true,
    });
  await wheel
    .getByRole("button", { name: "11:00 실행 배치", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", {
      name: "학습 결과 정리 1회차 이 시간에 배치",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(arc("11:00")).toBeVisible();
  const before = await f.getWeek(),
    id = before.state.occurrences[0].id;
  await arc("11:00").click();
  await expect(arc("11:00")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("Backspace");
  await expect(
    wheel.getByRole("button", { name: "실행 배치 취소", exact: true }),
  ).toBeEnabled();
  await expect(arc("11:00")).toHaveCount(0);
  const removed = await f.getWeek();
  expect(removed.daily).toEqual(before.daily);
  expect(removed.score).toEqual(before.score);
  expect(removed.state.tactics).toEqual(before.state.tactics);
  expect(removed.state.occurrences[0]).toEqual({
    ...before.state.occurrences[0],
    timePlaced: false,
  });
  await expect(
    page.locator(".task-list .task").filter({ hasText: "학습 결과 정리" }),
  ).toContainText("시간 미배치");
  await page.keyboard.press("Meta+z");
  await expect(arc("11:00")).toHaveCount(1);
  await expect(
    wheel.getByRole("button", { name: "실행 배치 다시 실행", exact: true }),
  ).toBeEnabled();
  expect((await f.getWeek()).state).toEqual(before.state);
  await page.keyboard.press("Meta+Shift+z");
  await expect(
    wheel.getByRole("button", { name: "실행 배치 취소", exact: true }),
  ).toBeEnabled();
  await expect(arc("11:00")).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(arc("11:00")).toHaveCount(1);
  await arc("11:00").dblclick();
  const timeInput = page.getByLabel("시작 시각", { exact: true });
  await timeInput.fill("13:00");
  await page.getByRole("button", { name: "일정 저장", exact: true }).click();
  await expect(arc("13:00")).toHaveCount(1);
  await wheel
    .getByRole("button", { name: "실행 배치 취소", exact: true })
    .click();
  await expect(arc("11:00")).toHaveCount(1);
  await wheel
    .getByRole("button", { name: "실행 배치 다시 실행", exact: true })
    .click();
  await expect(arc("13:00")).toHaveCount(1);
  await dragClock(page, wheel, "13:30", "15:30");
  await expect(arc("15:00")).toHaveCount(1);
  expect(
    (await f.getWeek()).state.occurrences.find((o) => o.id === id),
  ).toMatchObject({ time: "15:00", minutes: 60 });
  const moved = await f.getWeek();
  await dragClock(page, wheel, "15:30", "16:30", true);
  await expect(arc("15:00")).toHaveCount(1);
  expect(await f.getWeek()).toEqual(moved);
  await page.route("**/occurrences/*/schedule", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "저장 실패 시험" }),
    }),
  );
  await dragClock(page, wheel, "15:30", "16:30");
  await expect(page.getByText("저장 실패 시험", { exact: true })).toBeVisible();
  await expect(arc("15:00")).toHaveCount(1);
  expect(await f.getWeek()).toEqual(moved);
  await page.unroute("**/occurrences/*/schedule");
  await page.getByRole("button", { name: "주간 일정", exact: true }).click();
  const calendar = page.getByRole("region", { name: "이번 주 일정 캘린더" });
  await expect(
    calendar.getByRole("button", {
      name: "학습 결과 정리 · 수요일 15:00 · 60분",
      exact: true,
    }),
  ).toHaveCount(1);
  await page
    .getByRole("button", { name: "일간 실행 · 10분", exact: true })
    .click();
  await arc("15:00").click();
  await page.keyboard.press("Delete");
  await expect(arc("15:00")).toHaveCount(0);
  await page.getByRole("button", { name: "주간 일정", exact: true }).click();
  await expect(
    calendar.getByRole("button", { name: /학습 결과 정리 · 수요일/ }),
  ).toHaveCount(0);
  const unplaced = page
    .locator(".unscheduled")
    .getByRole("button", { name: /학습 결과 정리.*1회차/ });
  await expect(unplaced).toBeVisible();
  await unplaced.click();
  await page.getByLabel("시작 시각", { exact: true }).fill("16:00");
  await page.getByRole("button", { name: "일정 저장", exact: true }).click();
  await page
    .getByRole("button", { name: "일간 실행 · 10분", exact: true })
    .click();
  await expect(arc("16:00")).toHaveCount(1);
  expect((await f.getWeek()).daily).toEqual(before.daily);
  expect(await f.getCycle()).toEqual(cycle);
  expect(await f.getWeek(2)).toEqual(future);
  await page.setViewportSize({ width: 390, height: 844 });
  await arc("16:00").click();
  await wheel.screenshot({
    path: "test-results/daily-clock-shortcuts-mobile.png",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.reload();
  await expect(arc("16:00")).toHaveCount(1);
  expect(errors).toEqual([]);
});
test("daily clock unplaces daily time without removing the required date, protects completed work and clears history between weeks", async ({
  page,
  request,
}) => {
  const f = await setup(
    page,
    request,
    `일간 약속 보호 ${crypto.randomUUID().slice(0, 8)}`,
  );
  const wheel = page.getByRole("region", { name: "하루 원형 시간표" });
  const daily = wheel.getByRole("button", {
    name: "일일 기록 · 09:00 · 60분 일정 선택",
    exact: true,
  });
  const before = await f.getWeek();
  await daily.click();
  await page.keyboard.press("Delete");
  await expect(
    wheel.getByRole("button", { name: "실행 배치 취소", exact: true }),
  ).toBeEnabled();
  await expect(daily).toHaveCount(0);
  const untimed = await f.getWeek();
  expect(untimed.daily).toEqual(before.daily);
  expect(
    untimed.state.occurrences.find((o) => o.requiredDate === "2026-10-07"),
  ).toMatchObject({
    date: "2026-10-07",
    requiredDate: "2026-10-07",
    timePlaced: false,
  });
  await page.reload();
  await expect(daily).toHaveCount(0);
  await wheel
    .getByRole("button", { name: "11:00 실행 배치", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /일일 기록.*이 시간에 배치/ })
    .click();
  const restored = wheel.getByRole("button", {
    name: "일일 기록 · 11:00 · 60분 일정 선택",
    exact: true,
  });
  await restored.click();
  await page
    .getByRole("button", { name: "일일 기록 완료", exact: true })
    .click();
  const completed = await f.getWeek();
  await wheel
    .getByRole("img", { name: "일일 기록 · 11:00 · 60분 완료", exact: true })
    .dblclick();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    wheel.getByRole("button", { name: "시간 배치 해제", exact: true }),
  ).toBeDisabled();
  await wheel.focus();
  await page.keyboard.press("Delete");
  await page.keyboard.press("Meta+z");
  expect(await f.getWeek()).toEqual(completed);
  await page.getByLabel("주차 선택").selectOption("2");
  await expect(
    wheel.getByRole("button", { name: "실행 배치 취소", exact: true }),
  ).toBeDisabled();
});
test("an untimed promise can be completed without reappearing as work to schedule", async ({
  page,
  request,
}) => {
  const f = await setup(page, request, "시간 미배치 완료 검증");
  const wheel = page.getByRole("region", { name: "하루 원형 시간표" });
  await wheel
    .getByRole("button", {
      name: "일일 기록 · 09:00 · 60분 일정 선택",
      exact: true,
    })
    .click();
  await page.keyboard.press("Delete");
  await expect(
    wheel.getByRole("button", { name: /일일 기록.*일정 선택/ }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "일일 기록 완료", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "일일 기록 완료 취소", exact: true }),
  ).toHaveCount(1);
  const w = await f.getWeek();
  expect(
    w.state.occurrences.find((o) => o.requiredDate === "2026-10-07"),
  ).toMatchObject({ completed: true, timePlaced: false, date: "2026-10-07" });
  await page.getByRole("button", { name: "주간 일정", exact: true }).click();
  await expect(
    page.locator(".unscheduled").getByRole("button", { name: /일일 기록/ }),
  ).toHaveCount(0);
});
test("add a week-local repetition after confirmation from daily placement and the weekly timetable", async ({
  page,
  request,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const f = await setup(page, request, "주차 한정 실행 추가 검증");
  const original = await f.getWeek(),
    cycle = await f.getCycle(),
    future = await f.getWeek(2);
  const tactic = original.state.tactics.find(
    (t) => t.title === "학습 결과 정리",
  );
  const wheel = page.getByRole("region", { name: "하루 원형 시간표" });
  await wheel
    .getByRole("button", { name: "15:00 실행 배치", exact: true })
    .click();
  const picker = page.getByRole("dialog", { name: "이 시간에 실행 배치" });
  const extra = picker.getByRole("button", {
    name: "학습 결과 정리 이번 주 1회 더 추가",
    exact: true,
  });
  await expect(
    picker.getByRole("button", {
      name: "일일 기록 이번 주 1회 더 추가",
      exact: true,
    }),
  ).toHaveCount(0);
  page.once("dialog", async (d) => {
    expect(d.message()).toContain("최소 약속 3회와 평가 기준은 유지");
    expect(d.message()).toContain("추가 실행을 못해도 점수가 깎이지");
    await d.dismiss();
  });
  await extra.click();
  expect(await f.getWeek()).toEqual(original);
  await expect(picker).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await extra.click();
  await expect(picker).toHaveCount(0);
  const added = await f.getWeek();
  expect(added.state.tactics.find((t) => t.id === tactic.id).plannedCount).toBe(
    3,
  );
  expect(added.state.occurrences.slice(0, -1)).toEqual(
    original.state.occurrences,
  );
  expect(added.state.occurrences.at(-1)).toMatchObject({
    date: "2026-10-07",
    time: "15:00",
    completed: false,
  });
  expect(await f.getCycle()).toEqual(cycle);
  expect(await f.getWeek(2)).toEqual(future);
  await expect(page.getByText("추가 실행 · 일간 점수 기준 제외")).toBeVisible();
  await page
    .getByRole("button", { name: "학습 결과 정리 완료", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "학습 결과 정리 완료 취소", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const completedExtra = await f.getWeek();
  expect(
    completedExtra.state.tactics.find((t) => t.id === tactic.id).plannedCount,
  ).toBe(3);
  expect(completedExtra.score.rows.find((t) => t.id === tactic.id).rate).toBe(
    1 / 3,
  );
  expect(
    completedExtra.daily.find((d) => d.date === completedExtra.today).extraDone,
  ).toBe(1);
  await page.getByRole("button", { name: "주간 일정", exact: true }).click();
  await page
    .getByRole("button", { name: "이번 주 시간표 조정", exact: true })
    .click();
  const editor = page.getByRole("region", { name: "주차별 모범 주간 조정" });
  await editor
    .getByRole("button", { name: "시간 블록 추가", exact: true })
    .click();
  await page.getByLabel("배치할 전술", { exact: true }).selectOption(tactic.id);
  await page
    .getByLabel("배치할 실행 회차", { exact: true })
    .selectOption("extra");
  await page.getByLabel("블록 요일").selectOption("2");
  await page.getByLabel("블록 시작 시각").fill("17:00");
  page.once("dialog", async (d) => {
    expect(d.message()).toContain("최소 약속 3회와 평가 기준은 유지");
    await d.accept();
  });
  await page.getByRole("button", { name: "블록 적용", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const second = await f.getWeek();
  expect(
    second.state.tactics.find((t) => t.id === tactic.id).plannedCount,
  ).toBe(3);
  expect(second.state.occurrences.at(-1)).toMatchObject({
    date: "2026-10-07",
    time: "17:00",
    completed: false,
  });
  expect(await f.getCycle()).toEqual(cycle);
  expect(await f.getWeek(2)).toEqual(future);
  await page.reload();
  expect((await f.getWeek()).state).toEqual(second.state);
  await page
    .getByRole("button", { name: "이번 주 계획표", exact: true })
    .click();
  const summary = page.getByRole("region", { name: "이번 주 할 일" });
  await expect(summary).toContainText("추가 실행 1회 완료 / 2회 등록");
  await expect(summary).toContainText("기본 약속 10회");
  expect(errors).toEqual([]);
});
test("drag an unplaced execution, resize both edges, cancel, move and retain daily dates", async ({
  page,
  request,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1200 });
  const { getWeek } = await setup(page, request, "드래그 배치 검증");
  const before = await getWeek();
  await page.getByRole("button", { name: "주간 일정", exact: true }).click();
  const calendar = page.getByRole("region", { name: "이번 주 일정 캘린더" });
  await page
    .locator(".unscheduled")
    .getByRole("button", { name: /학습 결과 정리.*1회차/ })
    .dragTo(
      calendar.getByRole("button", {
        name: "수요일 08:00 블록 추가",
        exact: true,
      }),
      { targetPosition: { x: 20, y: 2 } },
    );
  const event = (time, minutes) =>
    calendar.getByRole("button", {
      name: `학습 결과 정리 · 수요일 ${time} · ${minutes}분`,
      exact: true,
    });
  await expect(event("08:00", 60)).toBeVisible();
  const shell = event("08:00", 60).locator("..");
  await dragHandle(
    page,
    shell.getByRole("button", { name: "학습 결과 정리 종료 시간 조절" }),
    56,
  );
  await expect(event("08:00", 120)).toBeVisible();
  await dragHandle(
    page,
    event("08:00", 120)
      .locator("..")
      .getByRole("button", { name: "학습 결과 정리 시작 시간 조절" }),
    -28,
  );
  await expect(event("07:30", 150)).toBeVisible();
  await dragHandle(
    page,
    event("07:30", 150)
      .locator("..")
      .getByRole("button", { name: "학습 결과 정리 종료 시간 조절" }),
    28,
    true,
  );
  await expect(event("07:30", 150)).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await event("07:30", 150).dragTo(
    calendar.getByRole("button", {
      name: "목요일 10:00 블록 추가",
      exact: true,
    }),
    { targetPosition: { x: 20, y: 2 } },
  );
  await expect(
    calendar.getByRole("button", {
      name: "학습 결과 정리 · 목요일 10:00 · 150분",
      exact: true,
    }),
  ).toBeVisible();
  // Daily execution dates remain fixed; a failed move must not change the plan.
  const daily = calendar.getByRole("button", {
    name: "일일 기록 · 수요일 09:00 · 60분",
    exact: true,
  });
  await daily.dragTo(
    calendar.getByRole("button", {
      name: "목요일 13:00 블록 추가",
      exact: true,
    }),
    { targetPosition: { x: 20, y: 2 } },
  );
  await expect(page.locator(".toast")).toHaveText(
    "매일 해야 하는 실행은 다른 날짜로 옮길 수 없어요.",
  );
  const after = await getWeek();
  expect(after.state.occurrences).toHaveLength(before.state.occurrences.length);
  expect(after.state.tactics).toEqual(before.state.tactics);
  expect(after.score.score).toEqual(before.score.score);
  const scheduled = after.state.occurrences.find(
    (o) => o.tacticId === before.state.tactics[0].id && o.date,
  );
  expect([scheduled.date, scheduled.time, scheduled.minutes]).toEqual([
    "2026-10-08",
    "10:00",
    150,
  ]);
  await page.reload();

  await page.getByRole("button", { name: "주간 일정", exact: true }).click();
  await expect(
    calendar.getByRole("button", {
      name: "학습 결과 정리 · 목요일 10:00 · 150분",
      exact: true,
    }),
  ).toBeVisible();
  await calendar.screenshot({ path: "test-results/34-drag-resize-week.png" });
  await page.route("**/occurrences/*/schedule", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "저장 실패 시험" }),
    }),
  );
  await calendar
    .getByRole("button", { name: "학습 결과 정리 종료 시간 조절" })
    .press("ArrowDown");
  await expect(page.getByRole("alert")).toContainText("저장 실패 시험");
  await expect(
    calendar.getByRole("button", {
      name: "학습 결과 정리 · 목요일 10:00 · 150분",
      exact: true,
    }),
  ).toBeVisible();
  await page.unroute("**/occurrences/*/schedule");
  await page
    .getByRole("button", { name: "일간 실행 · 10분", exact: true })
    .click();
  await page
    .getByRole("button", { name: "일일 기록 완료", exact: true })
    .click();
  await page.getByRole("button", { name: "주간 일정", exact: true }).click();
  await expect(daily).toBeDisabled();
  await expect(
    daily.locator("..").locator(".calendar-resize-handle"),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});
test("daily circular placement shares weekly edits, future removal and Sunday review boundary", async ({
  page,
  request,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const { getWeek } = await setup(page, request, "원형 시간표 검증");
  const wheel = page.getByRole("region", { name: "하루 원형 시간표" });
  await wheel
    .getByRole("button", { name: "11:00 실행 배치", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "이 시간에 실행 배치" })
    .getByRole("button", { name: /학습 결과 정리.*1회차/ })
    .click();
  const arc = wheel.getByRole("button", {
    name: "학습 결과 정리 · 11:00 · 60분 일정 선택",
    exact: true,
  });
  await expect(arc).toBeVisible();
  await arc.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await arc.dblclick();
  await expect(
    page.getByRole("button", { name: "배치 해제", exact: true }),
  ).toHaveCount(1);
  await page.getByLabel("시작 시각", { exact: true }).fill("12:00");
  await page.getByLabel("예상 시간(분)").fill("90");
  await page.getByRole("button", { name: "일정 저장", exact: true }).click();
  await page.getByRole("button", { name: "주간 일정", exact: true }).click();
  const calendar = page.getByRole("region", { name: "이번 주 일정 캘린더" });
  await expect(
    calendar.getByRole("button", {
      name: "학습 결과 정리 · 수요일 12:00 · 90분",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "일간 실행 · 10분", exact: true })
    .click();
  await page.locator(".day-strip button").nth(6).click();
  await expect(
    wheel.getByRole("img", {
      name: "주간 평가 · 30분 · 01:00 · 30분 모범 주간",
      exact: true,
    }),
  ).toBeVisible();
  await page.locator(".day-strip button").nth(5).click();
  await expect(wheel.getByRole("img", { name: /주간 평가/ })).toHaveCount(0);
  await page.getByLabel("주차 선택").selectOption("2");
  await wheel
    .getByRole("button", { name: "13:00 실행 배치", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /학습 결과 정리.*1회차/ })
    .click();
  await wheel
    .getByRole("button", {
      name: "학습 결과 정리 · 13:00 · 60분 일정 선택",
      exact: true,
    })
    .dblclick();
  await page.getByRole("button", { name: "배치 해제", exact: true }).click();
  await expect(
    wheel.getByRole("button", { name: /학습 결과 정리.*일정 선택/ }),
  ).toHaveCount(0);
  const future = await getWeek(2);
  expect(
    future.state.occurrences.filter((o) => !o.date || o.timePlaced === false),
  ).toHaveLength(3);
  expect(future.state.occurrences[0]).toMatchObject({
    date: "2026-10-12",
    timePlaced: false,
  });
  expect(future.state.occurrences).toHaveLength(10);
  await page.setViewportSize({ width: 390, height: 844 });
  await wheel.scrollIntoViewIfNeeded();
  await wheel.screenshot({ path: "test-results/35-daily-clock-mobile.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("mobile touch handles adjust execution edges without scrolling the calendar", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, request, "터치 시간 조절 검증");
  await page.getByRole("button", { name: "주간 일정", exact: true }).click();
  await page
    .locator(".unscheduled")
    .getByRole("button", { name: /학습 결과 정리.*1회차/ })
    .click();
  await page.getByLabel("평가 날짜").fill("2026-10-07");
  await page.getByRole("button", { name: "일정 저장", exact: true }).click();
  const calendar = page.getByRole("region", { name: "이번 주 일정 캘린더" });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 1,
  });
  async function touchHandle(name, delta) {
    const handle = calendar.getByRole("button", { name });
    await handle.scrollIntoViewIfNeeded();
    const box = await handle.boundingBox();
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    for (let i = 1; i <= 4; i++)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: y + (delta * i) / 4 }],
      });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  }
  await touchHandle("학습 결과 정리 종료 시간 조절", 28);
  await expect(
    calendar.getByRole("button", {
      name: "학습 결과 정리 · 수요일 09:00 · 90분",
      exact: true,
    }),
  ).toBeVisible();
  await touchHandle("학습 결과 정리 시작 시간 조절", 28);
  await expect(
    calendar.getByRole("button", {
      name: "학습 결과 정리 · 수요일 09:30 · 60분",
      exact: true,
    }),
  ).toBeVisible();
  await cdp.detach();
});

test("daily ring shows details, draws time, sounds focus and rest alarms, and waits for manual starts", async ({
  page,
  request,
}) => {
  await page.addInitScript(() => {
    const NativeAudio = window.AudioContext;
    window.__timerAudio = { starts: 0, contexts: [] };
    window.AudioContext = class extends NativeAudio {
      constructor(...args) {
        super(...args);
        window.__timerAudio.contexts.push(this);
      }
      createOscillator() {
        const oscillator = super.createOscillator();
        const start = oscillator.start.bind(oscillator);
        oscillator.start = (...args) => {
          window.__timerAudio.starts++;
          return start(...args);
        };
        return oscillator;
      }
    };
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const { getWeek } = await setup(page, request, "원형 드래그와 타이머 검증");
  const wheel = page.getByRole("region", { name: "하루 원형 시간표" });
  const reference = wheel.getByRole("img", {
    name: "모범 집중 블록 · 09:00 · 120분 모범 주간",
    exact: true,
  });
  await reference.hover();
  await expect(wheel.getByRole("tooltip", { name: "일정 상세" })).toContainText(
    "모범 집중 블록",
  );
  await expect(wheel.getByRole("tooltip")).toContainText("09:00–11:00");
  const svg = wheel.locator("svg.daily-clock");
  await svg.scrollIntoViewIfNeeded();
  const box = await svg.boundingBox();
  const point = (minutes) => {
    const angle = (minutes / 1440) * Math.PI * 2 - Math.PI / 2;
    return {
      x: box.x + (box.width * (200 + 123 * Math.cos(angle))) / 400,
      y: box.y + (box.height * (200 + 123 * Math.sin(angle))) / 400,
    };
  };
  const from = point(495),
    to = point(600);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await expect(
    wheel.getByRole("status", { name: "선택한 시간" }),
  ).toContainText("12:00–14:00 · 120분");
  await page.mouse.up();
  await page
    .getByRole("dialog", { name: "이 시간에 실행 배치" })
    .getByRole("button", { name: /학습 결과 정리.*1회차/ })
    .click();
  await expect(
    wheel.getByRole("button", {
      name: "학습 결과 정리 · 12:00 · 120분 일정 선택",
      exact: true,
    }),
  ).toBeVisible();
  expect((await getWeek()).state.occurrences).toHaveLength(10);
  const clock = wheel.getByLabel("현재 한국 시간");
  await page.clock.setFixedTime(new Date("2026-10-07T12:00:02+09:00"));
  await expect(clock.locator("time")).toHaveText("12:00:02");
  const timer = wheel.getByRole("region", { name: "집중 타이머" });
  const rendered = await page.evaluate(async () => {
    const { playTimerChime } = await import("/src/timer-alarm.js");
    const context = new OfflineAudioContext(1, 44100, 44100);
    playTimerChime(context);
    const buffer = (await context.startRendering()).getChannelData(0);
    return [0.04, 0.28, 0.52, 0.9].map((second) => {
      const samples = buffer.slice(
        Math.floor(second * 44100),
        Math.floor((second + 0.02) * 44100),
      );
      return (
        samples.reduce((sum, sample) => sum + sample * sample, 0) /
        samples.length
      );
    });
  });
  expect(rendered.slice(0, 3).every((energy) => energy > 0.00001)).toBe(true);
  expect(rendered[3]).toBe(0);
  await timer
    .getByRole("button", { name: "알람 소리 확인", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => window.__timerAudio.starts))
    .toBeGreaterThanOrEqual(3);
  await timer.getByRole("button", { name: "시작", exact: true }).click();
  await page.getByRole("button", { name: "주간 일정", exact: true }).click();
  await page.clock.setFixedTime(new Date("2026-10-07T12:25:03+09:00"));
  await expect
    .poll(() => page.evaluate(() => window.__timerAudio.starts))
    .toBeGreaterThanOrEqual(6);
  await expect(
    page.getByRole("alert", { name: "타이머 완료 알림" }),
  ).toContainText("집중 시간이 끝났어요.");
  await page
    .getByRole("button", { name: "일간 실행 · 10분", exact: true })
    .click();
  await expect(timer.getByRole("timer")).toHaveText("00:00");
  await expect(timer.getByRole("status")).toHaveText(
    "집중 완료 · 다음 시작 대기",
  );
  await expect(
    timer.getByRole("button", { name: "집중 25분", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.clock.setFixedTime(new Date("2026-10-07T13:25:03+09:00"));
  await expect(timer.getByRole("timer")).toHaveText("00:00");
  await timer.getByRole("button", { name: "알람 끄기", exact: true }).click();
  const silenced = await page.evaluate(() => window.__timerAudio.starts);
  await page.waitForTimeout(4200);
  expect(await page.evaluate(() => window.__timerAudio.starts)).toBe(silenced);
  await timer
    .getByRole("button", { name: "짧은 휴식 5분 시작", exact: true })
    .click();
  await expect(timer.getByRole("timer")).toHaveText("05:00");
  await page.clock.setFixedTime(new Date("2026-10-07T13:30:04+09:00"));
  await expect(timer.getByRole("timer")).toHaveText("00:00");
  await expect(timer.getByRole("status")).toHaveText(
    "짧은 휴식 완료 · 다음 시작 대기",
  );
  await expect
    .poll(() => page.evaluate(() => window.__timerAudio.starts))
    .toBeGreaterThan(silenced);
  await timer
    .getByRole("button", { name: "집중 25분 시작", exact: true })
    .click();
  await page.clock.setFixedTime(new Date("2026-10-07T13:30:05+09:00"));
  await expect(timer.getByRole("timer")).toHaveText("24:59");
  await page.reload();

  await expect(timer.getByRole("timer")).toHaveText("24:59");
  await timer.getByRole("button", { name: "일시정지", exact: true }).click();
  await page.clock.setFixedTime(new Date("2026-10-07T14:30:05+09:00"));
  await expect(timer.getByRole("timer")).toHaveText("24:59");
  await timer.getByRole("button", { name: "초기화", exact: true }).click();
  await expect(timer.getByRole("timer")).toHaveText("25:00");
  await timer
    .getByRole("button", { name: "긴 휴식 10분", exact: true })
    .click();
  await timer.getByRole("button", { name: "시작", exact: true }).click();
  await page.clock.setFixedTime(new Date("2026-10-07T14:40:06+09:00"));
  await expect(timer.getByRole("timer")).toHaveText("00:00");
  await expect(timer.getByRole("status")).toHaveText(
    "긴 휴식 완료 · 다음 시작 대기",
  );
  await expect
    .poll(() => page.evaluate(() => window.__timerAudio.starts))
    .toBeGreaterThanOrEqual(3);
  await timer.getByRole("button", { name: "알람 끄기", exact: true }).click();
  await page.reload();

  await expect(timer.getByRole("timer")).toHaveText("00:00");
  await expect(
    timer.getByRole("button", { name: "알람 꺼짐", exact: true }),
  ).toBeDisabled();
  await reference.focus();
  await wheel.screenshot({
    path: "test-results/36-day-clock-timer-desktop.png",
  });
  await expect(wheel.getByRole("tooltip", { name: "일정 상세" })).toContainText(
    "모범 집중 블록",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await wheel.screenshot({
    path: "test-results/37-day-clock-timer-mobile.png",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("choose work, strategy, buffer and rest blocks before drawing and retain their types", async ({
  page,
  request,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1200 });
  const { getCycle, getWeek } = await setup(
    page,
    request,
    "블록 종류 선택 검증",
  );
  const original = await getCycle(),
    beforeWeek = await getWeek(),
    beforeFuture = await getWeek(2);
  await page
    .getByRole("button", { name: "이번 주 시간표 조정", exact: true })
    .click();
  const editor = page.getByRole("region", { name: "주차별 모범 주간 조정" });
  const calendar = editor.getByRole("region", { name: "모범 주간 캘린더" });
  const choose = (title) =>
    editor.getByRole("button", { name: `새 블록 종류: ${title}`, exact: true });
  await choose("근무·고정 일정").click();
  await expect(choose("근무·고정 일정")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const from = calendar.getByRole("button", {
    name: "수요일 10:00 블록 추가",
    exact: true,
  });
  await from.scrollIntoViewIfNeeded();
  const a = await from.boundingBox(),
    b = await calendar
      .getByRole("button", { name: "수요일 11:30 블록 추가", exact: true })
      .boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + 2, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByLabel("블록 종류", { exact: true })).toHaveValue(
    "fixed",
  );
  await expect(page.getByLabel("배치할 전술")).toHaveCount(0);
  await expect(page.getByLabel("블록 길이(분)")).toHaveValue("90");
  await page.getByLabel("할 활동", { exact: true }).fill("신규 맥날 근무");
  await page.getByLabel("블록 길이(분)").fill("480");
  await page.getByRole("button", { name: "블록 적용", exact: true }).click();
  const work = calendar.getByRole("button", {
    name: "신규 맥날 근무 · 수요일 10:00 · 480분",
    exact: true,
  });
  await expect(work).toHaveClass(/fixed/);
  // Editing the kind updates the visible color and remains undoable.
  await work.dblclick();
  await page.getByLabel("블록 종류", { exact: true }).selectOption("buffer");
  await page.getByRole("button", { name: "블록 적용", exact: true }).click();
  await expect(work).toHaveClass(/buffer/);
  await editor
    .getByRole("button", { name: "시간표 실행 취소", exact: true })
    .click();
  await expect(work).toHaveClass(/fixed/);
  const examples = [
    ["전략", "strategy", "개인 작업", "1", "11:00"],
    ["버퍼", "buffer", "연락 정리", "4", "14:00"],
    ["브레이크아웃", "breakout", "휴식", "6", "11:00"],
  ];
  for (const [label, kind, title, day, time] of examples) {
    await choose(label).click();
    await editor
      .getByRole("button", { name: "시간 블록 추가", exact: true })
      .click();
    await expect(page.getByLabel("블록 종류", { exact: true })).toHaveValue(
      kind,
    );
    await page.getByLabel("할 활동", { exact: true }).fill(title);
    await page.getByLabel("블록 요일").selectOption(day);
    await page.getByLabel("블록 시작 시각").fill(time);
    await page.getByLabel("블록 길이(분)").fill("60");
    await page.getByRole("button", { name: "블록 적용", exact: true }).click();
    await expect(
      calendar.locator(`.calendar-event.${kind}`).filter({ hasText: title }),
    ).toHaveCount(1);
  }
  const colors = await calendar
    .locator(".calendar-event")
    .evaluateAll((els) =>
      ["신규 맥날 근무", "개인 작업", "연락 정리", "휴식"].map(
        (title) =>
          getComputedStyle(els.find((el) => el.textContent.includes(title)))
            .backgroundColor,
      ),
    );
  expect(new Set(colors).size).toBe(4);
  // The type selector is above the tactic form and can leave execution mode directly.
  await choose("전술 실행").click();
  await editor
    .getByRole("button", { name: "시간 블록 추가", exact: true })
    .click();
  const kindBox = await page
      .getByLabel("블록 종류", { exact: true })
      .boundingBox(),
    tacticBox = await page.getByLabel("배치할 전술").boundingBox();
  expect(kindBox.y).toBeLessThan(tacticBox.y);
  await page.getByLabel("블록 종류", { exact: true }).selectOption("fixed");
  await expect(page.getByLabel("할 활동", { exact: true })).toBeVisible();
  await expect(page.getByLabel("배치할 전술")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await choose("근무·고정 일정").click();
  await editor.screenshot({ path: "test-results/47-block-kinds-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await editor
    .locator(".calendar-kind-picker")
    .screenshot({ path: "test-results/48-block-kinds-mobile.png" });
  await page
    .getByRole("button", { name: "이번 주 시간표 저장", exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  const stored = await getCycle();
  expect(stored.plan.goals).toEqual(original.plan.goals);
  expect(stored.plan.modelWeek).toEqual(original.plan.modelWeek);
  expect((await getWeek()).state).toEqual(beforeWeek.state);
  expect((await getWeek(2)).state).toEqual(beforeFuture.state);
  for (const [title, kind] of [
    ["신규 맥날 근무", "fixed"],
    ["개인 작업", "strategy"],
    ["연락 정리", "buffer"],
    ["휴식", "breakout"],
  ]) {
    expect(
      stored.plan.weeklyModelWeeks[0].blocks.find((b) => b.title === title)
        .kind,
    ).toBe(kind);
  }
  await page.reload();

  await page
    .getByRole("button", { name: "이번 주 시간표 조정", exact: true })
    .click();
  await expect(work).toHaveClass(/fixed/);
  expect(errors).toEqual([]);
});

test("calendar selection, deletion, undo, double-click editing and execution protection", async ({
  page,
  request,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1200 });
  const { getWeek, getCycle } = await setup(
    page,
    request,
    "시간표 단축키 검증",
  );
  const before = await getWeek(),
    original = await getCycle();
  await page
    .getByRole("button", { name: "이번 주 시간표 조정", exact: true })
    .click();
  const editor = page.getByRole("region", { name: "주차별 모범 주간 조정" });
  const calendar = editor.getByRole("region", { name: "모범 주간 캘린더" });
  const event = (title, day, time, minutes) =>
    calendar.getByRole("button", {
      name: `${title} · ${day}요일 ${time} · ${minutes}분`,
      exact: true,
    });
  const shift = () => event("맥날 근무", "월", "19:00", 360);
  await shift().click();
  await expect(shift()).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("Backspace");
  await expect(shift()).toHaveCount(0);
  await page.keyboard.press("Meta+z");
  await expect(shift()).toHaveCount(1);
  await page.keyboard.press("Meta+Shift+z");
  await expect(shift()).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(shift()).toHaveCount(1);

  await shift().dblclick();
  await expect(page.getByLabel("할 활동", { exact: true })).toHaveValue(
    "맥날 근무",
  );
  // Text editing owns its Backspace and native undo, not the calendar shortcut.
  await page.getByLabel("할 활동", { exact: true }).press("End");
  await page.keyboard.press("Backspace");
  await expect(shift()).toHaveCount(1);
  await page.getByLabel("할 활동", { exact: true }).fill("맥날 변경 근무");
  await page.getByRole("button", { name: "블록 적용", exact: true }).click();
  await expect(event("맥날 변경 근무", "월", "19:00", 360)).toHaveCount(1);
  await editor
    .getByRole("button", { name: "시간표 실행 취소", exact: true })
    .click();
  await expect(shift()).toHaveCount(1);
  await shift().press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.keyboard.press("Escape");

  // Move and resize are part of the same draft history.
  await event("모범 집중 블록", "수", "09:00", 120).dragTo(
    calendar.getByRole("button", {
      name: "목요일 10:00 블록 추가",
      exact: true,
    }),
    { targetPosition: { x: 20, y: 2 } },
  );
  const moved = () => event("모범 집중 블록", "목", "10:00", 120);
  await expect(moved()).toHaveCount(1);
  await moved().focus();
  await page.keyboard.press("Meta+z");
  await expect(event("모범 집중 블록", "수", "09:00", 120)).toHaveCount(1);
  await event("모범 집중 블록", "수", "09:00", 120).click();
  await dragHandle(
    page,
    event("모범 집중 블록", "수", "09:00", 120)
      .locator("..")
      .getByRole("button", { name: "모범 집중 블록 종료 시간 조절" }),
    28,
  );
  await expect(event("모범 집중 블록", "수", "09:00", 150)).toHaveCount(1);
  await event("모범 집중 블록", "수", "09:00", 150).press("Meta+z");
  await expect(event("모범 집중 블록", "수", "09:00", 120)).toHaveCount(1);

  // New blocks and dialog deletion can be undone too.
  await editor
    .getByRole("button", { name: "시간 블록 추가", exact: true })
    .click();
  await page.getByLabel("블록 종류", { exact: true }).selectOption("fixed");
  await page.getByLabel("할 활동", { exact: true }).fill("추가한 휴식");
  await page.getByRole("button", { name: "블록 적용", exact: true }).click();
  await expect(event("추가한 휴식", "월", "09:00", 180)).toHaveCount(1);
  await editor
    .getByRole("button", { name: "시간표 실행 취소", exact: true })
    .click();
  await expect(event("추가한 휴식", "월", "09:00", 180)).toHaveCount(0);
  await shift().dblclick();
  await page.getByRole("button", { name: "블록 삭제", exact: true }).click();
  await expect(shift()).toHaveCount(0);
  await page.keyboard.press("Meta+z");
  await expect(shift()).toHaveCount(1);

  // Execution commitments cannot be deleted or changed by draft undo.
  await editor
    .getByRole("button", { name: "시간 블록 추가", exact: true })
    .click();
  const tactic = before.state.tactics.find((t) => t.kind === "weekly");
  await page.getByLabel("배치할 전술").selectOption(tactic.id);
  await page.getByLabel("블록 요일").selectOption("2");
  await page.getByLabel("블록 시작 시각").fill("12:00");
  await page.getByRole("button", { name: "블록 적용", exact: true }).click();
  const execution = event("학습 결과 정리", "수", "12:00", 180);
  await execution.click();
  await page.keyboard.press("Delete");
  await expect(execution).toHaveCount(1);
  await expect(editor.getByRole("status")).toContainText("주간 약속을 유지");
  expect((await getWeek()).state.tactics).toEqual(before.state.tactics);
  expect((await getWeek()).score).toEqual(before.score);

  // Persist a restored draft and confirm score/other weeks are untouched.
  await editor.screenshot({ path: "test-results/46-calendar-shortcuts.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "이번 주 시간표 저장", exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  expect((await getCycle()).plan.modelWeek).toEqual(original.plan.modelWeek);
  expect((await getCycle()).plan.weeklyModelWeeks[0].blocks).toEqual(
    original.plan.modelWeek,
  );
  await page.reload();

  await page
    .getByRole("button", { name: "이번 주 시간표 조정", exact: true })
    .click();
  await expect(
    editor.getByRole("button", { name: "시간표 실행 취소", exact: true }),
  ).toBeDisabled();
  expect(errors).toEqual([]);
});

test("adjust weekly shifts independently, promote a new default, reset and preserve execution records", async ({
  page,
  request,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const { getWeek, getCycle } = await setup(
    page,
    request,
    "주차별 근무 조정 검증",
  );
  const original = await getCycle(),
    beforeWeek = await getWeek();
  const wheel = page.getByRole("region", { name: "하루 원형 시간표" });
  const paints = await wheel
    .locator(".daily-clock-block")
    .evaluateAll((items) =>
      items.map((el) => el.style.getPropertyValue("--block-color")),
    );
  expect(paints.every(Boolean)).toBe(true);
  async function changeShift(from, to, minutes) {
    const editor = page.getByRole("region", { name: "주차별 모범 주간 조정" });
    await editor
      .getByRole("button", {
        name: `맥날 근무 · 월요일 ${from} · ${minutes}분`,
        exact: true,
      })
      .dblclick();
    await page.getByLabel("블록 시작 시각").fill(to);
    await page.getByLabel("블록 길이(분)").fill("480");
    await page.getByRole("button", { name: "블록 적용", exact: true }).click();
  }
  await page
    .getByRole("button", { name: "주간 평가 · 30분", exact: true })
    .click();
  await page
    .getByLabel("실행과 결과에서 발견한 것")
    .fill("저장 전 주간 평가 초안");
  await page
    .getByRole("button", { name: "일간 실행 · 10분", exact: true })
    .click();
  await wheel
    .getByRole("button", { name: "이번 주 시간표 조정", exact: true })
    .click();
  await changeShift("19:00", "17:00", 360);
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByLabel("주차 선택").selectOption("2");
  await expect(page.getByLabel("주차 선택")).toHaveValue("1");
  await page
    .getByRole("button", { name: "이번 주 시간표 저장", exact: true })
    .click();
  await expect(wheel).toBeVisible();
  let stored = await getCycle();
  expect(stored.plan.modelWeek).toEqual(original.plan.modelWeek);
  expect(
    stored.plan.weeklyModelWeeks[0].blocks.find((b) => b.title === "맥날 근무")
      .time,
  ).toBe("17:00");
  expect(stored.plan.goals).toEqual(original.plan.goals);
  expect((await getWeek()).state).toEqual(beforeWeek.state);
  await page
    .getByRole("button", { name: "주간 평가 · 30분", exact: true })
    .click();
  await expect(page.getByLabel("실행과 결과에서 발견한 것")).toHaveValue(
    "저장 전 주간 평가 초안",
  );
  await page.getByLabel("실행과 결과에서 발견한 것").fill("");
  await page
    .getByRole("button", { name: "일간 실행 · 10분", exact: true })
    .click();
  await page.reload();

  await page.locator(".day-strip button").first().click();
  await expect(
    wheel.getByRole("img", {
      name: "맥날 근무 · 17:00 · 480분 주차별 시간표",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel("주차 선택").selectOption("2");
  await wheel
    .getByRole("button", { name: "이번 주 시간표 조정", exact: true })
    .click();
  await changeShift("19:00", "15:00", 360);
  await page.getByLabel("기본 모범 주간에도 반영하기").check();
  await page
    .getByRole("button", { name: "이번 주 시간표 저장", exact: true })
    .click();
  await expect(wheel).toBeVisible();
  stored = await getCycle();
  expect(stored.plan.modelWeek.find((b) => b.title === "맥날 근무").time).toBe(
    "15:00",
  );
  expect(
    stored.plan.weeklyModelWeeks
      .find((w) => w.week === 1)
      .blocks.find((b) => b.title === "맥날 근무").time,
  ).toBe("17:00");
  await page.getByRole("button", { name: "주간 일정", exact: true }).click();
  await page
    .getByRole("button", { name: "이번 주 시간표 조정", exact: true })
    .click();
  await page
    .getByRole("button", { name: "이번 주 별도 설정 해제", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "시간표 실행 취소", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "이번 주 시간표 저장", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "이번 주 일정 캘린더" }),
  ).toBeVisible();
  expect((await getCycle()).plan.weeklyModelWeeks.map((w) => w.week)).toEqual([
    1,
  ]);
  await page.getByLabel("주차 선택").selectOption("1");
  expect((await getWeek()).state).toEqual(beforeWeek.state);
  await page
    .getByRole("button", { name: "일간 실행 · 10분", exact: true })
    .click();
  await page.locator(".day-strip button").nth(2).click();
  await wheel.screenshot({ path: "test-results/38-colored-day-blocks.png" });
  expect(errors).toEqual([]);
});

test("current week plan and new tactic blocks schedule existing occurrences without creating model duplicates", async ({
  page,
  request,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const { getWeek, getCycle } = await setup(
    page,
    request,
    "전술 블록과 이번 주 계획표 검증",
  );
  const original = await getWeek(),
    cycle = await getCycle();
  const weekly = original.state.tactics.find((t) => t.kind === "weekly"),
    daily = original.state.tactics.find((t) => t.kind === "daily");
  await page
    .getByRole("button", { name: "이번 주 계획표", exact: true })
    .click();
  const plan = page.getByRole("region", {
    name: "이번 주 계획표",
    exact: true,
  });
  const actions = plan.getByRole("region", { name: "이번 주 할 일" });
  await expect(actions).toBeVisible();
  await expect(actions.locator(".current-week-action")).toHaveCount(2);
  await expect(actions.getByText("아직 시간 미정 3회")).toBeVisible();
  await expect(plan.locator(".current-week-details")).not.toHaveAttribute(
    "open",
    "",
  );
  const actionBounds = await actions.boundingBox();
  const timetableBounds = await plan
    .getByRole("region", { name: "주차별 시간표" })
    .boundingBox();
  expect(actionBounds.y).toBeLessThan(timetableBounds.y);
  await expect(plan).toContainText("목표 1개 · 전술 2개 · 실행 10회");
  await expect(plan).toContainText("설명과 초안 저장");
  await plan
    .getByRole("button", { name: "학습 결과 정리 1회차 배치", exact: true })
    .click();
  await page.getByLabel("평가 날짜").fill("2026-10-07");
  await page.getByLabel("시작 시각", { exact: true }).fill("11:00");
  await page.getByRole("button", { name: "일정 저장", exact: true }).click();
  await expect(plan).toContainText("10.07 11:00 · 60분");
  await plan
    .getByRole("button", { name: "주간 일정으로 보기", exact: true })
    .click();
  await page
    .getByRole("button", { name: "이번 주 시간표 조정", exact: true })
    .click();
  const editor = page.getByRole("region", { name: "주차별 모범 주간 조정" });
  await editor
    .getByRole("button", { name: "수요일 12:30 블록 추가", exact: true })
    .click();
  await expect(page.getByLabel("블록 종류", { exact: true })).toHaveValue(
    "execution",
  );
  await page.getByLabel("배치할 전술").selectOption(weekly.id);
  await expect(page.getByLabel("배치할 실행 회차")).toHaveValue(
    `${weekly.id}~1`,
  );
  await page.getByLabel("블록 길이(분)").fill("90");
  await page.getByRole("button", { name: "블록 적용", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    editor.getByRole("button", {
      name: "학습 결과 정리 · 수요일 12:30 · 90분",
      exact: true,
    }),
  ).toBeVisible();
  let stored = await getWeek();
  expect(
    stored.state.occurrences.find((o) => o.id === `${weekly.id}~1`),
  ).toMatchObject({
    date: "2026-10-07",
    time: "12:30",
    minutes: 90,
    completed: false,
  });
  expect((await getCycle()).plan.modelWeek).toEqual(cycle.plan.modelWeek);
  // Choosing a placed occurrence moves it; it must not consume another repetition.
  await editor
    .getByRole("button", { name: "시간 블록 추가", exact: true })
    .click();
  await page.getByLabel("배치할 전술").selectOption(weekly.id);
  await page.getByLabel("배치할 실행 회차").selectOption(`${weekly.id}~1`);
  await page.getByLabel("블록 요일").selectOption("2");
  await page.getByLabel("블록 시작 시각").fill("16:00");
  await page.getByLabel("블록 길이(분)").fill("30");
  await page.getByRole("button", { name: "블록 적용", exact: true }).click();
  await expect(
    editor.getByRole("button", {
      name: "학습 결과 정리 · 수요일 16:00 · 30분",
      exact: true,
    }),
  ).toBeVisible();
  // Daily selection follows the day's existing occurrence, never moves it to another date.
  await editor
    .getByRole("button", { name: "시간 블록 추가", exact: true })
    .click();
  await page.getByLabel("배치할 전술").selectOption(daily.id);
  await page.getByLabel("블록 요일").selectOption("3");
  await expect(page.getByLabel("배치할 실행 회차")).toHaveValue(
    `${daily.id}~3`,
  );
  await page.getByLabel("블록 시작 시각").fill("17:00");
  await page.getByLabel("블록 길이(분)").fill("30");
  await page.getByRole("button", { name: "블록 적용", exact: true }).click();
  await expect(
    editor.getByRole("button", {
      name: "일일 기록 · 목요일 17:00 · 30분",
      exact: true,
    }),
  ).toBeVisible();
  stored = await getWeek();
  expect(stored.state.occurrences).toHaveLength(
    original.state.occurrences.length,
  );
  expect(stored.state.tactics).toEqual(original.state.tactics);
  expect(stored.score.score).toEqual(original.score.score);
  expect(
    stored.state.occurrences.find((o) => o.id === `${daily.id}~3`).requiredDate,
  ).toBe("2026-10-08");
  await page
    .getByRole("button", { name: "이번 주 계획표", exact: true })
    .click();
  await expect(
    plan.getByRole("region", { name: "주차별 모범 주간 조정" }),
  ).toBeVisible();
  await expect(plan).toContainText("10.07 16:00 · 30분");
  await expect(plan).toContainText("10.08 17:00 · 30분");
  await plan.screenshot({ path: "test-results/39-current-week-plan.png" });
  await page.reload();

  await page
    .getByRole("button", { name: "이번 주 계획표", exact: true })
    .click();
  await expect(plan).toContainText("10.07 16:00 · 30분");
  await page.setViewportSize({ width: 390, height: 844 });
  await plan.screenshot({
    path: "test-results/40-current-week-plan-mobile.png",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("current week action board keeps a long tactic list compact until expanded", async ({
  page,
  request,
}) => {
  await setup(page, request, "긴 주간 실행 목록", (plan) => {
    for (let index = 1; index <= 4; index += 1) {
      plan.goals[0].tactics.push({
        id: crypto.randomUUID(),
        title: `추가 전술 ${index}`,
        condition: `완료 기준 ${index}`,
        kind: "weekly",
        count: 1,
        weeks: [1],
      });
    }
  });
  await page
    .getByRole("button", { name: "이번 주 계획표", exact: true })
    .click();
  const actions = page.getByRole("region", { name: "이번 주 할 일" });
  await expect(actions.locator(".current-week-action")).toHaveCount(4);
  await expect(
    actions.getByRole("button", { name: "나머지 2개 할 일 보기" }),
  ).toBeVisible();
  await expect(
    actions.locator(".current-week-action-condition").first(),
  ).not.toHaveAttribute("open", "");
  await actions.getByRole("button", { name: "나머지 2개 할 일 보기" }).click();
  await expect(actions.locator(".current-week-action")).toHaveCount(6);
  await actions.getByRole("button", { name: "처음 4개만 보기" }).click();
  await expect(actions.locator(".current-week-action")).toHaveCount(4);
});

test("current week action board separates missed executions from placement and preserves stored records", async ({
  page,
  request,
}) => {
  const { getWeek, getCycle } = await setup(
    page,
    request,
    `주간 실행 상태 구분 ${crypto.randomUUID().slice(0, 8)}`,
    (plan) =>
      plan.goals[0].tactics.push({
        id: crypto.randomUUID(),
        title: "지나간 약속",
        condition: "자료 정리",
        kind: "once",
        count: 1,
        weeks: [1, 2],
      }),
  );
  const cycle = await getCycle();
  const token = await page.evaluate(() => localStorage.getItem("twelve.token"));
  const headers = { Authorization: `Bearer ${token}` };
  const prefix = `http://127.0.0.1:4111/api/cycles/${cycle.id}/weeks/1`;
  let week = await getWeek();
  const weekly = week.state.tactics.find((t) => t.kind === "weekly");
  const daily = week.state.tactics.find((t) => t.kind === "daily");
  const pastOnly = week.state.tactics.find((t) => t.title === "지나간 약속");
  const schedule = async (id, date, timePlaced) => {
    const response = await request.put(`${prefix}/occurrences/${id}/schedule`, {
      headers,
      data: {
        version: week.version,
        date,
        time: "09:00",
        minutes: 60,
        timePlaced,
      },
    });
    expect(response.ok()).toBe(true);
    week = await response.json();
  };
  await schedule(`${weekly.id}~0`, "2026-10-06", false);
  const completion = await request.put(
    `${prefix}/occurrences/${weekly.id}~0/completion`,
    {
      headers,
      data: {
        version: week.version,
        completed: true,
        executedAt: "2026-10-06T09:00:00+09:00",
      },
    },
  );
  expect(completion.ok()).toBe(true);
  week = await completion.json();
  await schedule(`${weekly.id}~1`, "2026-10-06", false);
  await schedule(`${weekly.id}~2`, "2026-10-07", true);
  await schedule(`${daily.id}~2`, "2026-10-07", false);
  await schedule(`${pastOnly.id}~0`, "2026-10-06", false);
  const before = await getWeek();
  const writes = [];
  page.on("request", (r) => {
    if (
      r.url().includes("/api/") &&
      ["POST", "PUT", "DELETE"].includes(r.method())
    )
      writes.push(r.url());
  });
  await page.reload();
  await page
    .getByRole("button", { name: "이번 주 계획표", exact: true })
    .click();
  const plan = page.getByRole("region", {
    name: "이번 주 계획표",
    exact: true,
  });
  const actions = plan.getByRole("region", { name: "이번 주 할 일" });
  const counts = actions.getByLabel("이번 주 실행 현황");
  await expect(counts.getByText("완료 1회", { exact: true })).toBeVisible();
  await expect(
    counts.getByText("실행 없이 지남 4회", { exact: true }),
  ).toBeVisible();
  await expect(
    counts.getByText("예정·미완료 5회", { exact: true }),
  ).toBeVisible();
  await expect(
    counts.getByText("아직 시간 미정 1회", { exact: true }),
  ).toBeVisible();
  await expect(actions).toContainText("합계는 전체 11회");
  const pastCard = actions
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: "지나간 약속" }) });
  await expect(pastCard.getByText("실행 없이 지남 1회")).toBeVisible();
  await expect(
    pastCard.getByRole("button", { name: /시간 정하기/ }),
  ).toHaveCount(0);
  await pastCard
    .getByRole("button", { name: "지나간 약속 지난 실행 확인" })
    .click();
  const details = plan.locator(".current-week-details");
  await expect(details).toHaveAttribute("open", "");
  await expect(details.locator('[data-status="missed"]')).toHaveCount(4);
  await expect(details.locator('[data-status="unplaced"]')).toHaveCount(1);
  await expect(details.locator('[data-status="completed"]')).toHaveCount(1);
  await expect(details.locator('[data-status="scheduled"]')).toHaveCount(5);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await actions.screenshot({
    path: "test-results/current-week-execution-status-mobile.png",
  });
  expect((await getWeek()).state).toEqual(before.state);
  expect((await getWeek()).score).toEqual(before.score);
  expect((await getCycle()).plan).toEqual(cycle.plan);
  expect(writes).toEqual([]);
});

test("current week plan edits in place and copies a regular block to a chosen time", async ({
  page,
  request,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const { getCycle, getWeek } = await setup(
    page,
    request,
    "계획표 바로 편집과 복사 검증",
  );
  const originalWeek = await getWeek();
  await page
    .getByRole("button", { name: "이번 주 계획표", exact: true })
    .click();
  const plan = page.getByRole("region", {
    name: "이번 주 계획표",
    exact: true,
  });
  const editor = plan.getByRole("region", { name: "주차별 모범 주간 조정" });
  await expect(editor).toBeVisible();
  await expect(
    plan.getByRole("button", { name: "이번 주 시간표 조정" }),
  ).toHaveCount(0);
  await expect(
    editor.getByRole("button", { name: "새 블록 종류: 전략" }),
  ).toHaveAttribute("aria-pressed", "true");
  const calendar = editor.getByRole("region", { name: "모범 주간 캘린더" });
  await calendar
    .getByRole("button", { name: "모범 집중 블록 · 수요일 09:00 · 120분" })
    .click();
  await page.keyboard.press("Meta+c");
  await expect(
    editor.getByRole("group", { name: "복사한 시간 블록" }),
  ).toBeVisible();
  await calendar
    .getByRole("button", { name: "목요일 12:00 블록 추가" })
    .click();
  await page.keyboard.press("Meta+v");
  await expect(
    calendar.getByRole("button", {
      name: "모범 집중 블록 · 목요일 12:00 · 120분",
    }),
  ).toBeVisible();
  expect(
    (await getCycle()).plan.modelWeek.filter(
      (b) => b.title === "모범 집중 블록",
    ),
  ).toHaveLength(1);
  await editor
    .getByRole("button", { name: "이번 주 시간표 저장", exact: true })
    .click();
  await expect(editor).toBeVisible();
  const saved = await getCycle();
  expect(
    saved.plan.weeklyModelWeeks[0].blocks.filter(
      (b) => b.title === "모범 집중 블록",
    ),
  ).toHaveLength(2);
  expect((await getWeek()).state).toEqual(originalWeek.state);
  await page.reload();
  await expect(
    plan.getByRole("region", { name: "주차별 모범 주간 조정" }),
  ).toBeVisible();
  await expect(
    plan.getByRole("button", { name: "모범 집중 블록 · 목요일 12:00 · 120분" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("current week plan shows the whole day without an inner vertical scrollbar", async ({
  page,
  request,
}) => {
  await setup(page, request, "주간 시간표 전체 높이 검증");
  await page
    .getByRole("button", { name: "이번 주 계획표", exact: true })
    .click();
  const plan = page.getByRole("region", {
    name: "이번 주 계획표",
    exact: true,
  });
  const scroll = plan.locator(".calendar-scroll");
  await expect(scroll).toBeVisible();
  expect(
    await scroll.evaluate((element) => element.clientHeight),
  ).toBeGreaterThan(24 * 56);
  expect(
    await scroll.evaluate(
      (element) => element.scrollHeight - element.clientHeight,
    ),
  ).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await scroll.evaluate(
      (element) => element.scrollHeight - element.clientHeight,
    ),
  ).toBeLessThanOrEqual(1);
  expect(
    await scroll.evaluate(
      (element) => element.scrollWidth > element.clientWidth,
    ),
  ).toBe(true);
});

test("copying a tactic execution confirms and adds one occurrence only to this week", async ({
  page,
  request,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const { getCycle, getWeek } = await setup(
    page,
    request,
    "전술 실행 복사 확인 검증",
  );
  const originalCycle = await getCycle();
  const originalWeek = await getWeek();
  const futureWeek = await getWeek(2);
  const tactic = originalWeek.state.tactics.find((t) => t.kind === "weekly");
  await page
    .getByRole("button", { name: "이번 주 계획표", exact: true })
    .click();
  const plan = page.getByRole("region", {
    name: "이번 주 계획표",
    exact: true,
  });
  await plan.getByRole("button", { name: "학습 결과 정리 1회차 배치" }).click();
  await page.getByLabel("평가 날짜").fill("2026-10-07");
  await page.getByLabel("시작 시각", { exact: true }).fill("12:00");
  await page.getByRole("button", { name: "일정 저장", exact: true }).click();
  const editor = plan.getByRole("region", { name: "주차별 모범 주간 조정" });
  const calendar = editor.getByRole("region", { name: "모범 주간 캘린더" });
  await calendar
    .getByRole("button", { name: "학습 결과 정리 · 수요일 12:00 · 60분" })
    .click();
  await page.keyboard.press("Meta+c");
  await calendar
    .getByRole("button", { name: "목요일 13:00 블록 추가" })
    .click();
  page.once("dialog", async (dialog) => await dialog.dismiss());
  await page.keyboard.press("Meta+v");
  expect((await getWeek()).state.occurrences).toHaveLength(
    originalWeek.state.occurrences.length,
  );
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("최소 약속 3회와 평가 기준은 유지");
    await dialog.accept();
  });
  await page.keyboard.press("Meta+v");
  await expect(
    calendar.getByRole("button", {
      name: "학습 결과 정리 · 목요일 13:00 · 60분",
    }),
  ).toBeVisible();
  const updated = await getWeek();
  expect(
    updated.state.tactics.find((t) => t.id === tactic.id).plannedCount,
  ).toBe(3);
  expect(updated.state.occurrences).toHaveLength(
    originalWeek.state.occurrences.length + 1,
  );
  expect(updated.state.occurrences.at(-1)).toMatchObject({
    date: "2026-10-08",
    time: "13:00",
    minutes: 60,
    completed: false,
  });
  expect(await getWeek(2)).toEqual(futureWeek);
  expect((await getCycle()).plan).toEqual(originalCycle.plan);
  await calendar
    .getByRole("button", { name: "일일 기록 · 월요일 09:00 · 60분" })
    .click();
  await page.keyboard.press("Meta+c");
  await calendar
    .getByRole("button", { name: "목요일 14:00 블록 추가" })
    .click();
  await page.keyboard.press("Meta+v");
  await expect(editor.getByRole("status")).toContainText(
    "매일 전술은 하루 한 회차로 고정되어 복제할 수 없어요",
  );
  expect((await getWeek()).state.occurrences).toHaveLength(
    updated.state.occurrences.length,
  );
  expect(errors).toEqual([]);
});

test("authored life attitudes, weekly timetable fallback and overnight sleep share the exported week", async ({
  page,
  request,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1200 });
  const { getWeek, getCycle } = await setup(
    page,
    request,
    "삶의 태도와 주간 시간표 검증",
    (plan) => {
      plan.responsibilityActions.personal =
        "시작할 수 있는 행동을 고른다\n잠들기 전 내 선택을 확인한다";
      plan.responsibilityActions.business = "내 책임 범위를 분명히 한다";
      plan.pastCommitments[0] = {
        promise: "달리기를 시작한 약속",
        action: "퇴근 후 신발을 신었다",
        benefit: "시작하는 힘을 얻었다",
      };
      Object.assign(plan.commitments[0], {
        promise: "건강을 지킨다",
        action: "꾸준히 달리기",
        cost: "퇴근 후 20분",
        accepted: true,
      });
      Object.assign(plan.commitments[1], {
        promise: "생각 중인 다른 약속",
        action: "선택 전 행동",
        accepted: false,
      });
      plan.modelWeek.push({
        id: crypto.randomUUID(),
        day: 6,
        time: "03:00",
        minutes: 360,
        kind: "fixed",
        title: "수면",
      });
      plan.weeklyModelWeeks = [
        {
          week: 1,
          blocks: plan.modelWeek.map((block) =>
            block.title === "맥날 근무"
              ? { ...block, time: "17:00" }
              : { ...block },
          ),
        },
      ];
    },
  );
  const initialWeek = await getWeek();
  const attitude = page.getByLabel("나의 삶의 태도", { exact: true });
  const messages = [
    "시작할 수 있는 행동을 고른다",
    "잠들기 전 내 선택을 확인한다",
    "내 책임 범위를 분명히 한다",
    "달리기를 시작한 약속",
    "건강을 지킨다",
  ];
  const seen = new Set();
  for (let i = 0; i < messages.length; i++) {
    await expect(attitude.locator(".attitude-message")).toHaveCount(1);
    const text = await attitude.locator(".attitude-message").innerText();
    expect(messages).toContain(text);
    expect(seen.has(text)).toBe(false);
    seen.add(text);
    await expect(attitude).not.toContainText("생각 중인 다른 약속");
    if (text === "건강을 지킨다" || text === "달리기를 시작한 약속") {
      const extra = attitude.getByText("함께 적어둔 내용", { exact: true });
      await extra.click();
      await expect(attitude).toContainText(
        text === "건강을 지킨다" ? "퇴근 후 20분" : "시작하는 힘을 얻었다",
      );
    }
    await attitude
      .getByRole("button", { name: "다른 약속 보기", exact: true })
      .click();
  }
  expect(seen.size).toBe(messages.length);
  const stableMessage = await attitude.locator(".attitude-message").innerText();
  await page.screenshot({
    path: "test-results/43-one-reminder-desktop.png",
    fullPage: true,
  });
  await page.locator(".day-strip button").first().click();
  const wheel = page.getByRole("region", { name: "하루 원형 시간표" });
  await expect(
    wheel.getByRole("img", {
      name: "수면 · 04:00부터 · 360분 주차별 시간표",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "이번 주 계획표", exact: true })
    .click();
  const plan = page.getByRole("region", {
    name: "이번 주 계획표",
    exact: true,
  });
  await expect(plan).toContainText("1주차에 따로 저장한 시간표를 사용 중");
  await expect(attitude.locator(".attitude-message")).toHaveText(stableMessage);
  const table = plan.getByRole("region", {
    name: "모범 주간 캘린더",
    exact: true,
  });
  await expect(
    table.getByRole("button", {
      name: "맥날 근무 · 월요일 17:00 · 360분",
      exact: true,
    }),
  ).toBeVisible();
  await plan
    .getByRole("button", { name: "학습 결과 정리 1회차 배치", exact: true })
    .click();
  await page.getByLabel("평가 날짜").fill("2026-10-07");
  await page.getByLabel("시작 시각", { exact: true }).fill("11:00");
  await page.getByRole("button", { name: "일정 저장", exact: true }).click();
  await expect(plan).toContainText("10.07 11:00 · 60분");
  const exported = async () => {
    const downloading = page.waitForEvent("download");
    await plan
      .getByRole("button", { name: "Apple 캘린더로 내보내기", exact: true })
      .click();
    const download = await downloading;
    return new ICAL.Component(
      ICAL.parse(await readFile(await download.path(), "utf8")),
    ).getAllSubcomponents("vevent");
  };
  const first = await exported();
  const shift = first.find(
    (event) => event.getFirstPropertyValue("summary") === "맥날 근무",
  );
  expect(shift.getFirstPropertyValue("dtstart").toJSDate().toISOString()).toBe(
    "2026-10-05T08:00:00.000Z",
  );
  expect(
    first.some(
      (event) => event.getFirstPropertyValue("summary") === "학습 결과 정리",
    ),
  ).toBe(true);
  expect(
    first.filter((event) => event.getFirstPropertyValue("summary") === "수면"),
  ).toHaveLength(2);
  await plan.screenshot({ path: "test-results/41-weekly-timetable.png" });
  await page.getByLabel("주차 선택").selectOption("2");
  await expect(plan).toContainText(
    "별도 시간표가 없어 기본 모범 주간을 사용 중",
  );
  const second = await exported();
  expect(
    second
      .find((event) => event.getFirstPropertyValue("summary") === "맥날 근무")
      .getFirstPropertyValue("dtstart")
      .toJSDate()
      .toISOString(),
  ).toBe("2026-10-12T10:00:00.000Z");
  await page.setViewportSize({ width: 390, height: 844 });
  await attitude.screenshot({
    path: "test-results/42-life-attitude-mobile.png",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.reload();

  await expect(attitude.locator(".attitude-message")).toHaveCount(1);
  expect(messages).toContain(
    await attitude.locator(".attitude-message").innerText(),
  );
  expect((await getCycle()).plan.weeklyModelWeeks).toHaveLength(1);
  expect((await getWeek()).state.occurrences).toHaveLength(
    initialWeek.state.occurrences.length,
  );
  expect((await getWeek()).score).toEqual(initialWeek.score);
  expect(errors).toEqual([]);
});

test("choose a goal, see one row per tactic, move daily or placed work, and add scored tactics without losing old promises", async ({
  page,
  request,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1100 });
  const fixture = await setup(
    page,
    request,
    "목표 중심 실행 배치 검증",
    (plan) => {
      plan.goals[1].title = "자동화 흐름 완성하기";
      Object.assign(plan.goals[1].tactics[0], {
        title: "자동화 실험 인터뷰",
        condition: "질문과 답변 한 장 남기기",
        kind: "once",
        weeks: [2],
      });
    },
  );
  await fixture.updatePlan((plan) => {
    plan.goals[1].tactics[0].weeks = [1, 2];
  });
  await page.reload();

  const initial = await fixture.getWeek();
  const originalCycle = await fixture.getCycle();
  const wheel = page.getByRole("region", { name: "하루 원형 시간표" });
  const dialog = page.getByRole("dialog", { name: "이 시간에 실행 배치" });
  const goals = dialog.getByLabel("집중할 목표 선택");
  const open = async (time) =>
    wheel
      .getByRole("button", { name: `${time} 실행 배치`, exact: true })
      .click();
  const chooseGoal = async (name) =>
    goals.getByRole("button", { name: new RegExp(name) }).click();
  await open("11:00");
  await expect(goals.getByRole("button")).toHaveCount(2);
  await expect(dialog.locator(".execution-tactic-choice")).toHaveCount(0);
  await chooseGoal("집중해서 결과 남기기");
  await expect(dialog.locator(".execution-tactic-choice")).toHaveCount(2);
  await expect(
    dialog.getByRole("heading", { name: "학습 결과 정리", exact: true }),
  ).toHaveCount(1);
  const weekly = initial.state.tactics.find(
    (t) => t.title === "학습 결과 정리",
  );
  await dialog
    .getByLabel("학습 결과 정리 실행 회차", { exact: true })
    .selectOption(`${weekly.id}~1`);
  await dialog
    .getByRole("button", {
      name: "학습 결과 정리 2회차 이 시간에 배치",
      exact: true,
    })
    .click();
  await open("12:00");
  await chooseGoal("집중해서 결과 남기기");
  await expect(dialog.getByLabel("학습 결과 정리 실행 회차")).toContainText(
    "2회차 · 10.07 11:00 배치됨",
  );
  await dialog
    .getByLabel("학습 결과 정리 실행 회차")
    .selectOption(`${weekly.id}~1`);
  await dialog
    .getByRole("button", {
      name: "학습 결과 정리 2회차 이 시간으로 이동",
      exact: true,
    })
    .click();
  await expect(dialog).toHaveCount(0);
  let stored = await fixture.getWeek();
  expect(
    stored.state.occurrences.find((o) => o.id === `${weekly.id}~1`),
  ).toMatchObject({ date: "2026-10-07", time: "12:00" });
  expect(stored.state.occurrences).toHaveLength(
    initial.state.occurrences.length,
  );
  await open("13:00");
  await chooseGoal("집중해서 결과 남기기");
  await expect(
    dialog.getByLabel("일일 기록 실행 회차").locator("option"),
  ).toHaveCount(1);
  await dialog
    .getByRole("button", {
      name: "일일 기록 3회차 이 시간으로 이동",
      exact: true,
    })
    .click();
  await expect(dialog).toHaveCount(0);
  stored = await fixture.getWeek();
  const daily = stored.state.occurrences.find(
    (o) => o.requiredDate === "2026-10-07",
  );
  expect(daily).toMatchObject({ date: "2026-10-07", time: "13:00" });
  await page
    .getByRole("button", { name: "주간 평가 · 30분", exact: true })
    .click();
  await page
    .getByLabel("실행과 결과에서 발견한 것")
    .fill("저장하지 않은 회고도 유지");
  await page
    .getByRole("button", { name: "일간 실행 · 10분", exact: true })
    .click();
  await open("14:00");
  await chooseGoal("자동화 흐름 완성하기");
  await expect(dialog).toContainText(
    "이 목표에는 이번 주에 확정된 전술이 없어요.",
  );
  await dialog
    .getByText("이번 주 목록에 없던 전술 1개 · 이유 확인", { exact: true })
    .click();
  await expect(dialog).toContainText("주간 기준이 확정된 뒤에 변경");
  await dialog
    .getByRole("button", { name: "이 전술을 이번 주에 가져오기", exact: true })
    .click();
  const form = dialog.getByRole("form", { name: "목표에 전술 추가" });
  await expect(form.getByLabel("추가할 전술 이름")).toHaveValue(
    "자동화 실험 인터뷰",
  );
  await expect(form).toContainText("이번 주 평가에 포함");
  await form
    .getByRole("button", { name: "전술 추가하고 배치", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  stored = await fixture.getWeek();
  expect(stored.score.rows).toHaveLength(initial.score.rows.length + 1);
  const adopted = originalCycle.plan.goals[1].tactics[0];
  expect(
    stored.state.occurrences.find((o) => o.tacticId === adopted.id),
  ).toMatchObject({ date: "2026-10-07", time: "14:00" });
  expect((await fixture.getCycle()).plan.goals[1].tactics).toHaveLength(1);
  const beforeAddition = stored;
  await open("15:00");
  await chooseGoal("집중해서 결과 남기기");
  await dialog
    .getByRole("button", { name: "이 목표에 전술 추가", exact: true })
    .click();
  await form.getByLabel("추가할 전술 이름").fill("포트폴리오 설명 개선");
  await form
    .getByLabel("추가할 전술 완료 기준")
    .fill("프로젝트 선택 이유를 한 문단으로 저장");
  await form.getByLabel("추가할 전술 주당 횟수").fill("2");
  await form
    .getByRole("button", { name: "추가 전술 2주차", exact: true })
    .click();
  await page.route("**/weeks/1/tactics", (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: "다른 화면에서 변경된 내용 확인" }),
    }),
  );
  await form
    .getByRole("button", { name: "전술 추가하고 배치", exact: true })
    .click();
  await expect(form.getByRole("alert")).toContainText(
    "다른 화면에서 변경된 내용 확인",
  );
  await expect(form.getByLabel("추가할 전술 이름")).toHaveValue(
    "포트폴리오 설명 개선",
  );
  expect((await fixture.getWeek()).state).toEqual(beforeAddition.state);
  await page.unroute("**/weeks/1/tactics");
  await form
    .getByRole("button", { name: "전술 추가하고 배치", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  stored = await fixture.getWeek();
  const added = stored.state.tactics.find(
    (t) => t.title === "포트폴리오 설명 개선",
  );
  expect(added.plannedCount).toBe(2);
  expect(
    stored.state.occurrences.find((o) => o.id === `${added.id}~0`),
  ).toMatchObject({ date: "2026-10-07", time: "15:00" });
  expect(stored.score.rows).toHaveLength(initial.score.rows.length + 2);
  for (const item of beforeAddition.state.occurrences)
    expect(stored.state.occurrences.find((o) => o.id === item.id)).toEqual(
      item,
    );
  expect(
    (await fixture.getWeek(2)).state.tactics.some((t) => t.id === added.id),
  ).toBe(true);
  await page
    .getByRole("button", { name: "주간 평가 · 30분", exact: true })
    .click();
  await expect(page.getByLabel("실행과 결과에서 발견한 것")).toHaveValue(
    "저장하지 않은 회고도 유지",
  );
  await page.getByLabel("실행과 결과에서 발견한 것").fill("");
  await page
    .getByRole("button", { name: "일간 실행 · 10분", exact: true })
    .click();
  await open("16:00");
  await chooseGoal("집중해서 결과 남기기");
  await dialog.screenshot({
    path: "test-results/44-goal-execution-picker.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.screenshot({
    path: "test-results/45-goal-execution-picker-mobile.png",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await dialog.getByRole("button", { name: "닫기", exact: true }).click();
  await page.reload();

  expect((await fixture.getWeek()).state.occurrences).toHaveLength(
    initial.state.occurrences.length + 3,
  );
  await expect(
    wheel.getByRole("button", {
      name: "포트폴리오 설명 개선 · 15:00 · 60분 일정 선택",
      exact: true,
    }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("an expired legacy timer restores its finished phase and offers sound activation when playback is blocked", async ({
  page,
  request,
}) => {
  const fixture = await setup(page, request, "기존 타이머 완료 복원 검증");
  const cycle = await fixture.getCycle();
  await page.addInitScript(() => {
    const NativeAudio = window.AudioContext;
    window.AudioContext = class extends NativeAudio {
      constructor(...args) {
        super(...args);
        void this.suspend();
      }
      resume() {
        return Promise.reject(
          new DOMException("Playback blocked", "NotAllowedError"),
        );
      }
    };
  });
  await page.evaluate(
    (id) =>
      localStorage.setItem(
        `twelve.focusTimer.${id}`,
        JSON.stringify({
          phase: "short",
          running: true,
          remainingMs: 300000,
          endAt: Date.now() - 1000,
        }),
      ),
    cycle.id,
  );
  await page.reload();

  const timer = page.getByRole("region", { name: "집중 타이머" });
  await expect(timer.getByRole("timer")).toHaveText("00:00");
  await expect(timer.getByRole("status")).toHaveText(
    "짧은 휴식 완료 · 다음 시작 대기",
  );
  await expect(
    timer.getByRole("button", { name: "알람 소리 켜기", exact: true }),
  ).toBeVisible();
  await timer
    .getByRole("button", { name: "알람 소리 켜기", exact: true })
    .click();
  await expect(timer.getByRole("timer")).toHaveText("00:00");
  await timer.getByRole("button", { name: "알람 끄기", exact: true }).click();
  const saved = await page.evaluate(
    (id) => JSON.parse(localStorage.getItem(`twelve.focusTimer.${id}`)),
    cycle.id,
  );
  expect(saved).toMatchObject({
    phase: "short",
    running: false,
    remainingMs: 0,
    alarmSilenced: true,
  });
  expect(saved.finishedAt).toBeGreaterThan(0);
});
