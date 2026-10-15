import { test, expect } from "@playwright/test";

test("writing prompts stay visible beside each step, adapt to ten weeks and preserve user entries", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.setFixedTime(new Date("2026-10-07T12:00:00+09:00"));
  await page.goto("/");
  await page.getByLabel("새 유저 이름").fill("작성 안내 검증");
  await page.getByRole("button", { name: "나의 공간 만들기" }).click();
  await page.getByRole("button", { name: "첫 12주 작성하기" }).click();
  await page.getByLabel("이번 12주의 이름").fill("생각을 돕는 10주");
  await page.getByLabel("실행 주수").selectOption("10");
  await page.getByRole("button", { name: "비전부터 작성하기" }).click();
  const guide = (name) =>
    page.getByRole("complementary", { name: `${name} 작성 안내`, exact: true });
  await expect(guide("장기 비전")).toContainText("상상력을 최대한 펼치고");
  await expect(guide("장기 비전")).toBeVisible();
  await expect(guide("3년 비전")).toContainText("향후 3년");
  await page
    .getByRole("textbox", { name: "장기 비전 1", exact: true })
    .fill("내가 원하는 모습을 구체화한다");
  await page
    .getByRole("textbox", { name: "개인 생활의 비전 1", exact: true })
    .fill("건강과 원하는 체형");
  await page.getByRole("tab", { name: "10주 목표" }).click();
  await expect(guide("목표")).toContainText("이번 10주가 끝났을 때");
  await expect(
    page.getByRole("list", { name: "목표의 다섯 조건" }).getByRole("listitem"),
  ).toHaveCount(5);
  await page
    .getByLabel("10주 목표 1", { exact: true })
    .fill("옷이 잘 어울리는 체형 만들기");
  await page
    .getByLabel("10주 목표 2", { exact: true })
    .fill("근무를 지탱할 지구력 기르기");
  await page.screenshot({
    path: "test-results/27-guided-goals.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "10주 계획 세우기" }).click();
  for (const name of [
    "성공 기준",
    "성취했을 때 얻는 변화",
    "전술과 계획",
    "예상 장애물과 대응",
    "선행지표와 후행지표",
  ])
    await expect(guide(name)).toBeVisible();
  await expect(guide("전술과 계획")).toContainText("전부 실행할 필요는 없어요");
  await expect(guide("선행지표와 후행지표")).toContainText(
    "85%를 합격선으로 강제하지 않아요",
  );
  const condition = page.getByLabel("1회 완료 조건", { exact: true });
  const description = await condition.getAttribute("aria-describedby");
  await expect(page.locator(`[id="${description}"]`)).toContainText(
    "완료·미완료",
  );
  await page
    .getByLabel("성공 기준", { exact: true })
    .fill("시작과 종료 때 같은 기준으로 확인");
  await page
    .getByLabel("04. 성취했을 때 얻는 변화")
    .fill("원하는 옷을 입을 때의 만족");
  await page
    .getByLabel("전술 이름", { exact: true })
    .fill("정한 활동을 실행하고 기록");
  await condition.fill("정한 구성을 마치고 기록 한 건");
  await page
    .getByLabel("선행지표 · 내가 실행할 행동")
    .fill("정한 활동의 실행 횟수");
  const choices = page.getByRole("navigation", { name: "목표별 계획 선택" });
  await choices.getByRole("button", { name: /근무를 지탱할 지구력/ }).click();
  await page.getByLabel("전술 이름", { exact: true }).fill("주간 활동 기록");
  await condition.fill("실행한 활동 한 건 기록");
  await choices.getByRole("button", { name: /옷이 잘 어울리는 체형/ }).click();
  await page
    .locator(".goal-panel")
    .screenshot({ path: "test-results/28-guided-plan.png" });
  const save = async () => {
    const response = page.waitForResponse(
      (r) =>
        r.request().method() === "PUT" &&
        /\/api\/cycles\/[^/]+$/.test(new URL(r.url()).pathname),
    );
    await page.getByRole("button", { name: "저장", exact: true }).click();
    const result = await response;
    expect(result.ok()).toBe(true);
    await expect(page.getByRole("status")).toHaveText("계획을 저장했어요.");
    return result.json();
  };
  const before = await save();
  await page.getByRole("tab", { name: "모범 주간" }).click();
  await expect(guide("모범 주간")).toContainText("브레이크아웃 블록");
  await page
    .getByRole("button", { name: "시간 블록 추가", exact: true })
    .click();
  await page.getByLabel("블록 종류").selectOption("buffer");
  await expect(
    page.getByText(
      "연락·정리처럼 사소하지만 필요한 업무를 모아 처리하는 시간입니다.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await page.getByRole("tab", { name: "삶의 태도" }).click();
  for (const name of [
    "책임을 실천하는 태도",
    "지켜냈던 약속",
    "삶의 영역별 헌신",
  ])
    await expect(guide(name)).toBeVisible();
  await expect(guide("책임을 실천하는 태도")).toContainText(
    "조직의 책임까지 떠맡으라는 뜻은 아니에요",
  );
  await expect(guide("삶의 영역별 헌신")).toContainText(
    "자동 추가되지는 않아요",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of [
    "비전",
    "10주 목표",
    "10주 계획",
    "모범 주간",
    "삶의 태도",
  ]) {
    await page.getByRole("tab", { name: new RegExp(`${name}$`) }).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.getByRole("tab", { name: "10주 계획" }).click();
  await page.screenshot({
    path: "test-results/29-guided-writing-mobile.png",
    fullPage: true,
  });
  await expect(page.getByLabel("성공 기준", { exact: true })).toHaveValue(
    "시작과 종료 때 같은 기준으로 확인",
  );
  const after = await save();
  expect(after.plan).toEqual(before.plan);
  await page.reload();
  await page.getByRole("button", { name: /생각을 돕는 10주/ }).click();
  await expect(guide("장기 비전")).toBeVisible();
  await page.getByRole("tab", { name: "10주 계획" }).click();
  await expect(page.getByLabel("성공 기준", { exact: true })).toHaveValue(
    "시작과 종료 때 같은 기준으로 확인",
  );
  await page.getByRole("tab", { name: "삶의 태도" }).click();
  await page.getByRole("button", { name: "10주 착수", exact: true }).click();
  await page.getByRole("button", { name: "저장하고 10주 착수" }).click();
  await expect(guide("일간 실행")).toContainText("04:00");
  await page.getByRole("button", { name: "주간 일정", exact: true }).click();
  await expect(guide("주간 일정")).toContainText("매일 전술의 빠진 날");
  await page
    .getByRole("button", { name: "주간 평가 · 30분", exact: true })
    .click();
  await expect(guide("주간 평가")).toContainText(
    "실행 부족과 전술의 효과를 구분",
  );
  await page.getByLabel("주차 선택").selectOption("11");
  await expect(guide("주기 회고")).toContainText("지난 10주에 무엇이 남았고");
  expect(errors).toEqual([]);
});
