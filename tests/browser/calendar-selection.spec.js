import { test, expect } from "@playwright/test";

test("draw model-week ranges, cancel, scroll and restore saved duration", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("새 유저 이름").fill("시간 범위 선택 검증");
  await page.getByRole("button", { name: "나의 공간 만들기" }).click();
  await page.getByRole("button", { name: "첫 12주 작성하기" }).click();
  await page.getByRole("button", { name: "비전부터 작성하기" }).click();
  await page.getByRole("tab", { name: "모범 주간" }).click();
  const calendar = page.getByRole("region", { name: "모범 주간 캘린더" });
  const scroller = calendar.locator(".calendar-scroll");
  await scroller.scrollIntoViewIfNeeded();
  async function point(day, time) {
    const box = await calendar
      .getByRole("button", {
        name: `${day}요일 ${time} 블록 추가`,
        exact: true,
      })
      .boundingBox();
    return { x: box.x + box.width / 2, y: box.y + 2 };
  }
  async function draw(day, start, end) {
    const from = await point(day, start);
    const to = await point(day, end);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
  }
  await draw("수", "09:00", "10:30");
  await expect(calendar.getByRole("status")).toContainText("09:00–10:30");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.screenshot({ path: "test-results/12-calendar-draw.png" });
  await page.mouse.up();
  await expect(page.getByLabel("블록 요일")).toHaveValue("2");
  await expect(page.getByLabel("블록 시작 시각")).toHaveValue("09:00");
  await expect(page.getByLabel("블록 길이(분)")).toHaveValue("90");
  await page
    .getByLabel("할 활동", { exact: true })
    .fill("드래그로 만든 집중 시간");
  await page.getByRole("button", { name: "블록 적용" }).click();

  await draw("금", "12:00", "10:30");
  await expect(calendar.getByRole("status")).toContainText("10:30–12:00");
  await page.mouse.up();
  await expect(page.getByLabel("블록 시작 시각")).toHaveValue("10:30");
  await expect(page.getByLabel("블록 길이(분)")).toHaveValue("90");
  await page
    .getByLabel("할 활동", { exact: true })
    .fill("위로 드래그한 회복 시간");
  await page.getByRole("button", { name: "블록 적용" }).click();

  await draw("목", "09:00", "10:30");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(calendar.getByRole("status")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(calendar.locator(".calendar-event")).toHaveCount(2);

  // Holding at the edge scrolls the time grid without releasing the selection.
  const from = await point("토", "12:00");
  const viewport = await scroller.boundingBox();
  const beforeScroll = await scroller.evaluate((el) => el.scrollTop);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, viewport.y + viewport.height - 3, { steps: 8 });
  await expect
    .poll(() => scroller.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(beforeScroll + 56);
  await page.mouse.up();
  await expect(page.getByLabel("블록 시작 시각")).toHaveValue("12:00");
  expect(
    Number(await page.getByLabel("블록 길이(분)").inputValue()),
  ).toBeGreaterThan(180);
  await page.keyboard.press("Escape");
  await expect(calendar.locator(".calendar-event")).toHaveCount(2);

  // Last slot ends at the following day's 04:00, without wrapping to zero length.
  await scroller.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const last = await point("일", "03:30");
  const column = await calendar.locator('[data-day="6"]').boundingBox();
  await page.mouse.move(last.x, last.y);
  await page.mouse.down();
  await page.mouse.move(last.x, column.y + column.height - 2, { steps: 5 });
  await expect(calendar.getByRole("status")).toContainText(
    "다음 날 03:30–04:00",
  );
  await page.mouse.up();
  await expect(page.getByLabel("블록 시작 시각")).toHaveValue("03:30");
  await expect(page.getByLabel("블록 길이(분)")).toHaveValue("30");
  await page.keyboard.press("Escape");

  // A keyboard activation still offers the existing three-hour default.
  await scroller.evaluate((el) => {
    el.scrollTop = 168;
  });
  await calendar
    .getByRole("button", { name: "월요일 09:00 블록 추가", exact: true })
    .press("Enter");
  await expect(page.getByLabel("블록 길이(분)")).toHaveValue("180");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("계획을 저장했어요.");
  await page.reload();
  await page.getByRole("button", { name: /나의 첫 12주/ }).click();
  await page.getByRole("tab", { name: "모범 주간" }).click();
  await expect(
    calendar.getByRole("button", {
      name: "드래그로 만든 집중 시간 · 수요일 09:00 · 90분",
      exact: true,
    }),
  ).toBeVisible();
  await expect(calendar.locator(".calendar-event")).toHaveCount(2);
  expect(errors).toEqual([]);
});
