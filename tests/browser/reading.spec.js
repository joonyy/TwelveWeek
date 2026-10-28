import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { emptyPlan } from "../../shared/domain.js";

async function setup(page, request) {
  const base = "http://127.0.0.1:4111/api";
  const profile = await (
    await request.post(`${base}/profiles`, {
      data: {
        password: "test-password",
        name: `독서 기록 ${randomUUID().slice(0, 8)}`,
      },
    })
  ).json();
  const { token } = await (
    await request.post(`${base}/sessions`, {
      data: { password: "test-password", profileId: profile.id },
    })
  ).json();
  const headers = { Authorization: `Bearer ${token}` };
  const plan = emptyPlan(2);
  plan.goals[0].title = "읽고 다시 활용하기";
  Object.assign(plan.goals[0].tactics[0], {
    title: "1단원 읽기",
    condition: "한 줄 생각 남기기",
    readingBook: "세컨드 브레인",
    count: 2,
    weeks: [1, 2],
  });
  let cycle = await (
    await request.post(`${base}/cycles`, {
      headers,
      data: {
        title: "독서 기록 검증",
        startDate: "2026-10-05",
        weekCount: 2,
        plan,
      },
    })
  ).json();
  const cycleUrl = `${base}/cycles/${cycle.id}`;
  cycle = await (
    await request.post(`${cycleUrl}/start`, {
      headers,
      data: { version: cycle.version },
    })
  ).json();
  const getWeek = async () =>
    (await request.get(`${cycleUrl}/weeks/1`, { headers })).json();
  let week = await getWeek();
  const occurrence = week.state.occurrences[0];
  const schedule = await request.put(
    `${cycleUrl}/weeks/1/occurrences/${occurrence.id}/schedule`,
    {
      headers,
      data: {
        version: week.version,
        date: week.today,
        time: "10:00",
        minutes: 30,
      },
    },
  );
  expect(schedule.ok()).toBe(true);
  week = await schedule.json();
  await page.clock.setFixedTime(new Date("2026-10-07T12:00:00+09:00"));
  await page.addInitScript(
    (token) => localStorage.setItem("twelve.token", token),
    token,
  );
  await page.goto(
    `/#cycle=${cycle.id}&view=week&week=1&mode=day&day=2026-10-07`,
  );
  await expect(
    page.getByRole("button", { name: "1단원 읽기 독서 기록", exact: true }),
  ).toBeVisible();
  return { cycle, headers, cycleUrl, getWeek, week };
}

test("reading drafts, completion, correction, book view and Markdown export survive reload", async ({
  page,
  request,
}) => {
  const f = await setup(page, request);
  await page
    .getByRole("button", { name: "1단원 읽기 독서 기록", exact: true })
    .click();
  const modal = page.getByRole("dialog", { name: "독서 기록", exact: true });
  await expect(page.getByLabel("독서 기록 책 이름")).toHaveValue(
    "세컨드 브레인",
  );
  await page.getByLabel("읽은 단원", { exact: true }).fill("1장");
  await page
    .getByLabel("한 줄 생각", { exact: true })
    .fill("기억보다 다시 꺼내 쓰는 흐름이 중요하다.");
  await page
    .getByRole("button", { name: "독서 기록 저장", exact: true })
    .click();
  await expect(modal).toHaveCount(0);
  const draft = await f.getWeek();
  expect(draft.score).toEqual(f.week.score);
  expect(draft.state.occurrences[0].completed).toBe(false);
  await page
    .getByRole("button", { name: "1단원 읽기 완료", exact: true })
    .click();
  await expect(modal).toBeVisible();
  await expect(page.getByLabel("한 줄 생각", { exact: true })).toHaveValue(
    "기억보다 다시 꺼내 쓰는 흐름이 중요하다.",
  );
  await page
    .getByRole("button", { name: "기록하고 실행 완료", exact: true })
    .click();
  await expect(modal).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "1단원 읽기 완료 취소", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const completed = await f.getWeek();
  expect(completed.score.rows[0].done).toBe(1);
  await page
    .getByRole("button", { name: "1단원 읽기 독서 기록", exact: true })
    .click();
  await page
    .getByLabel("한 줄 생각", { exact: true })
    .fill("다시 읽는 것보다 실제 작업에 재사용해보자.");
  await page
    .getByRole("button", { name: "독서 기록 저장", exact: true })
    .click();
  await expect(modal).toHaveCount(0);
  expect((await f.getWeek()).score).toEqual(completed.score);
  await page.locator(".reading-notebook > summary").click();
  const book = page.getByRole("region", {
    name: "세컨드 브레인 독서 기록",
    exact: true,
  });
  await expect(book).toContainText(
    "다시 읽는 것보다 실제 작업에 재사용해보자.",
  );
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "독서 기록 Markdown 내보내기" })
    .click();
  const download = await downloading;
  const md = await readFile(await download.path(), "utf8");
  expect(md).toContain("## 세컨드 브레인");
  expect(md).toContain("> 다시 읽는 것보다 실제 작업에 재사용해보자.");
  await page.reload();
  await expect(page.locator(".reading-record-preview")).toContainText(
    "다시 읽는 것보다 실제 작업에 재사용해보자.",
  );
  await page.locator(".reading-notebook > summary").click();
  await expect(book).toContainText("실행 완료");
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .locator(".reading-notebook")
    .screenshot({ path: "test-results/reading-notebook-mobile.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("failed reading saves retain inputs, and a goal's Notion link opens without rewriting execution records", async ({
  page,
  request,
}) => {
  const f = await setup(page, request);
  await page
    .getByRole("button", { name: "1단원 읽기 독서 기록", exact: true })
    .click();
  await page.getByLabel("읽은 단원", { exact: true }).fill("2장");
  await page
    .getByLabel("한 줄 생각", { exact: true })
    .fill("실패해도 입력이 남아야 한다.");
  const pattern = "**/occurrences/*/reading-record";
  await page.route(pattern, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "저장 실패 테스트" }),
    }),
  );
  await page
    .getByRole("button", { name: "독서 기록 저장", exact: true })
    .click();
  await expect(
    page.getByText("저장 실패 테스트", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("한 줄 생각", { exact: true })).toHaveValue(
    "실패해도 입력이 남아야 한다.",
  );
  expect((await f.getWeek()).state).toEqual(f.week.state);
  await page.unroute(pattern);
  await page
    .getByRole("button", { name: "독서 기록 저장", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "독서 기록", exact: true }),
  ).toHaveCount(0);
  const before = await f.getWeek();
  await page
    .getByRole("button", { name: "비전과 2주 계획", exact: true })
    .click();
  await page.getByRole("tab", { name: /2주 계획/ }).click();
  await page
    .getByText("기획서 링크 · Notion 등 (선택)", { exact: true })
    .click();
  const link = "https://app.notion.com/p/reading-project";
  await page.getByLabel("목표 기획서 링크", { exact: true }).fill(link);
  const saving = page.waitForResponse(
    (r) =>
      r.request().method() === "PUT" &&
      new URL(r.url()).pathname === new URL(f.cycleUrl).pathname,
  );
  await page.getByRole("button", { name: "저장", exact: true }).click();
  expect((await saving).ok()).toBe(true);
  await page.getByRole("button", { name: "실행과 평가", exact: true }).click();
  await page
    .getByRole("button", { name: "이번 주 계획표", exact: true })
    .click();
  await page.locator(".current-week-details > summary").click();
  const reference = page.getByRole("link", {
    name: "기획서 열기",
    exact: true,
  });
  await expect(reference).toHaveAttribute("href", link);
  await expect(reference).toHaveAttribute("rel", "noopener noreferrer");
  await page.reload();
  await page.locator(".current-week-details > summary").click();
  await expect(reference).toHaveAttribute("href", link);
  expect((await f.getWeek()).state).toEqual(before.state);
  expect((await f.getWeek()).score).toEqual(before.score);
  expect(
    (await (await request.get(f.cycleUrl, { headers: f.headers })).json()).plan
      .goals[0].referenceUrl,
  ).toBe(link);
});

test("reading notebook explains its source, stays hidden without reading work and keeps historical notes after the tactic changes", async ({
  page,
  request,
}) => {
  const f = await setup(page, request);
  await page.locator(".reading-notebook > summary").click();
  const notebook = page.locator(".reading-notebook");
  await expect(notebook).toContainText("독서 기록 모음");
  await expect(notebook).toContainText("1단원 읽기 (세컨드 브레인)");
  await expect(notebook).toContainText("한 줄 생각을 책별로 모읍니다");
  await expect(
    notebook.getByRole("button", { name: "독서 기록 Markdown 내보내기" }),
  ).toBeDisabled();
  // Remove the book from a future week's plan. No reading record exists yet.
  let fresh = await (
    await request.get(f.cycleUrl, { headers: f.headers })
  ).json();
  delete fresh.plan.goals[0].tactics[0].readingBook;
  const updated = await request.put(f.cycleUrl, {
    headers: f.headers,
    data: {
      version: fresh.version,
      title: fresh.title,
      startDate: fresh.start_date,
      weekCount: fresh.week_count,
      plan: fresh.plan,
    },
  });
  expect(updated.ok()).toBe(true);
  await request.get(`${f.cycleUrl}/weeks/2`, { headers: f.headers });
  const checked = page.waitForResponse((r) =>
    r.url().endsWith(`/cycles/${fresh.id}/reading-notes`),
  );
  await page.goto(
    `/#cycle=${fresh.id}&view=week&week=2&mode=day&day=2026-10-12`,
  );
  await page.reload();
  await checked;
  await expect(notebook).toHaveCount(0);
  // The frozen first-week tactic still exists. Save one note through its normal API.
  const week = await f.getWeek();
  const occurrence = week.state.occurrences[0];
  expect(
    (
      await request.put(
        `${f.cycleUrl}/weeks/1/occurrences/${occurrence.id}/reading-record`,
        {
          headers: f.headers,
          data: {
            version: week.version,
            record: {
              book: "세컨드 브레인",
              chapter: "1장",
              thought: "전술이 바뀌어도 남겨둘 기록",
            },
          },
        },
      )
    ).ok(),
  ).toBe(true);
  const before = await f.getWeek();
  const writes = [];
  page.on("request", (r) => {
    if (["POST", "PUT", "DELETE"].includes(r.method())) writes.push(r.url());
  });
  await page.reload();
  await expect(notebook).toBeVisible();
  await notebook.locator("summary").click();
  await expect(notebook).toContainText("전술이 바뀌어도 남겨둘 기록");
  expect(writes).toEqual([]);
  expect((await f.getWeek()).state).toEqual(before.state);
  expect((await f.getWeek()).score).toEqual(before.score);
});
