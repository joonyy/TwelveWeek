import { test, expect } from "@playwright/test";

test("list goals before tactics and preserve each goal's plan through switching, renaming and reload", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("새 유저 이름").fill("목표 전체 보기 검증");
  await page.getByLabel("새 유저 비밀번호").fill("test-password");
  await page.getByRole("button", { name: "나의 공간 만들기" }).click();
  await page.getByRole("button", { name: "첫 12주 작성하기" }).click();
  await page
    .getByLabel("이번 12주의 이름")
    .fill("전체 방향을 먼저 정하는 11주");
  await page.getByLabel("시작 월요일").fill("2026-10-12");
  await page.getByLabel("실행 주수").selectOption("11");
  await page.getByRole("button", { name: "비전부터 작성하기" }).click();
  await page.getByRole("tab", { name: "11주 목표" }).click();
  await expect(page.locator(".goal-list-row")).toHaveCount(3);
  await expect(page.getByLabel("전술 이름")).toHaveCount(0);
  await expect(page.getByLabel("성공 기준", { exact: true })).toHaveCount(0);
  await page
    .getByLabel("11주 목표 1", { exact: true })
    .fill("서비스 실제 사용 시험");
  await page
    .getByLabel("11주 목표 2", { exact: true })
    .fill("생활비 이후 저축 실험");
  await page.screenshot({
    path: "test-results/21-goal-list-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "11주 계획 세우기" }).click();
  const choices = page.getByRole("navigation", { name: "목표별 계획 선택" });
  await expect(choices.getByRole("button")).toHaveCount(2);
  await expect(page.locator(".goal-panel")).toHaveCount(1);
  await expect(page.locator(".goal-plan-title")).toHaveText(
    "서비스 실제 사용 시험",
  );
  await page
    .getByLabel("성공 기준", { exact: true })
    .fill("실제 사용 후 개선 기록 한 건");
  await page
    .getByLabel("04. 성취했을 때 얻는 변화")
    .fill("사용하는 서비스가 생긴다");
  await page.getByLabel("전술 이름").fill("실제로 사용하고 불편 기록하기");
  await page.getByLabel("1회 완료 조건").fill("불편과 다음 행동 한 건 저장");
  await page.getByLabel("주당 횟수").fill("2");
  await page.getByLabel("선행지표 · 내가 실행할 행동").fill("사용 기록 횟수");
  await choices.getByRole("button", { name: /생활비 이후 저축 실험/ }).click();
  await expect(page.getByLabel("전술 이름")).toHaveValue("");
  await page.getByLabel("전술 이름").fill("생활비와 저축 가능 금액 확인");
  await page.getByLabel("1회 완료 조건").fill("이번 주 금액 한 번 기록");
  await page.getByLabel("예상되는 어려움").fill("예상 밖 지출");
  await page.getByLabel("그때 취할 대응").fill("다음 주의 계획을 재검토");
  await choices.getByRole("button", { name: /서비스 실제 사용 시험/ }).click();
  await expect(page.getByLabel("전술 이름")).toHaveValue(
    "실제로 사용하고 불편 기록하기",
  );
  await expect(page.getByLabel("주당 횟수")).toHaveValue("2");
  await expect(page.getByLabel("성공 기준", { exact: true })).toHaveValue(
    "실제 사용 후 개선 기록 한 건",
  );
  await page.screenshot({
    path: "test-results/22-goal-plan-desktop.png",
    fullPage: true,
  });

  const save = async () => {
    const response = page.waitForResponse(
      (r) =>
        r.request().method() === "PUT" &&
        /\/api\/cycles\/[^/]+$/.test(new URL(r.url()).pathname),
    );
    await page.getByRole("button", { name: "저장", exact: true }).click();
    const saved = await response;
    expect(saved.ok()).toBe(true);
    await expect(page.getByRole("status")).toHaveText("계획을 저장했어요.");
    return saved.json();
  };
  const before = await save();
  await page.getByRole("button", { name: "목표 목록 수정" }).click();
  await page
    .getByLabel("11주 목표 1", { exact: true })
    .fill("TwelveWeek 실제 사용 시험");
  await page.getByRole("button", { name: "11주 목표 추가" }).click();
  await expect(page.locator(".goal-list-row")).toHaveCount(4);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "목표 4 삭제", exact: true }).click();
  await expect(page.locator(".goal-list-row")).toHaveCount(3);
  // A legacy goal with tactics but no title must remain accessible.
  await page.getByLabel("11주 목표 2", { exact: true }).fill("");
  await page.getByRole("tab", { name: "11주 계획" }).click();
  await expect(choices.getByRole("button")).toHaveCount(2);
  await choices.getByRole("button", { name: /이름 없는 목표/ }).click();
  await expect(page.getByLabel("전술 이름")).toHaveValue(
    "생활비와 저축 가능 금액 확인",
  );
  await expect(page.getByLabel("예상되는 어려움")).toHaveValue("예상 밖 지출");
  await page.getByRole("button", { name: "목표 목록 수정" }).click();
  await page
    .getByLabel("11주 목표 2", { exact: true })
    .fill("생활비 이후 저축 실험");
  const after = await save();
  expect(after.plan.goals.map((g) => g.id)).toEqual(
    before.plan.goals.map((g) => g.id),
  );
  expect(after.plan.goals.map((g) => g.tactics)).toEqual(
    before.plan.goals.map((g) => g.tactics),
  );
  expect(after.plan.goals.map((g) => g.difficulties)).toEqual(
    before.plan.goals.map((g) => g.difficulties),
  );
  expect(after.start_date).toBe(before.start_date);
  expect(after.week_count).toBe(11);
  await page.reload();

  await page.getByRole("tab", { name: "11주 목표" }).click();
  await expect(page.getByLabel("11주 목표 1", { exact: true })).toHaveValue(
    "TwelveWeek 실제 사용 시험",
  );
  await expect(page.getByLabel("11주 목표 2", { exact: true })).toHaveValue(
    "생활비 이후 저축 실험",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/23-goal-list-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "11주 계획 세우기" }).click();
  await choices.getByRole("button", { name: /생활비 이후 저축 실험/ }).click();
  await expect(page.getByLabel("전술 이름")).toHaveValue(
    "생활비와 저축 가능 금액 확인",
  );
  await page.screenshot({
    path: "test-results/24-goal-plan-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
