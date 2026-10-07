import { test, expect } from "@playwright/test";

test("Markdown conversations retain formatting after reload and stay within mobile width", async ({
  page,
}, testInfo) => {
  const markdown = [
    "# 장기비전을 넓히는 질문",
    "",
    "## 원하는 삶",
    "",
    "**선택의 자유**와 *소중한 사람과의 경험*을 생각해보세요.",
    "",
    "- 가격 때문에 포기하지 않는 경험",
    "  - 함께 떠나는 여행",
    "",
    "1. 어떤 선택을 하고 싶나요?",
    "2. 누구와 함께하고 싶나요?",
    "",
    "> 지금 가능한 것부터 검열하지 마세요.",
    "",
    "- [x] 방향 적어보기",
    "- [ ] ~~너무 이른 실행 계획~~",
    "",
    "인라인 코드: `longVision`",
    "",
    "```js",
    `const vision = "${"누적되는 선택의 자유 ".repeat(25)}";`,
    "```",
    "",
    "| 영역 | 원하는 경험 | 의미 | 지금의 생각 |",
    "| --- | --- | --- | --- |",
    "| 개인 생활 | 함께 떠나는 여행 | 선택의 자유 | 아직 더 생각할 내용 |",
    "| 일 | 누군가의 길잡이 | 도움의 누적 | 다양한 가능성을 상상 |",
    "",
    "[참고 링크](https://example.com/vision)",
    "",
    "---",
    "",
    "첫 번째 줄\n두 번째 줄",
    "",
    "<script>globalThis.markdownExecuted = true</script>",
    "",
    "[위험 링크](javascript:alert(1))",
  ].join("\n");
  await page.goto("/");
  await page
    .getByLabel("새 유저 이름")
    .fill(`Markdown 사용자 ${testInfo.repeatEachIndex}`);
  await page.getByRole("button", { name: "나의 공간 만들기" }).click();
  await page.getByRole("button", { name: "첫 12주 작성하기" }).click();
  await page.getByRole("button", { name: "비전부터 작성하기" }).click();
  await page.getByRole("button", { name: "AI와 비전 다듬기" }).click();
  await expect(
    page.getByRole("button", { name: "질문 하나로 시작하기" }),
  ).toBeEnabled();
  await page.getByRole("tab", { name: "연결", exact: true }).click();
  await page
    .getByRole("button", { name: "대화 가져오기", exact: true })
    .click();
  await page.getByLabel("대화 내용 또는 요약").fill(
    JSON.stringify([
      { role: "user", content: "내 비전을 정리해줘." },
      { role: "assistant", content: markdown },
    ]),
  );
  await page
    .getByRole("button", { name: "선택한 내용으로 대화 만들기" })
    .click();
  const reply = page.getByRole("log").locator("article.assistant");
  const heading = reply.getByRole("heading", {
    name: "장기비전을 넓히는 질문",
  });
  await expect(heading).toBeVisible();
  await expect(reply.locator("strong")).toHaveText("선택의 자유");
  await expect(reply.locator("em")).toHaveText("소중한 사람과의 경험");
  await expect(reply.locator("ul ul li")).toHaveText("함께 떠나는 여행");
  await expect(reply.locator("ol > li")).toHaveCount(2);
  await expect(reply.locator("blockquote")).toContainText("검열하지 마세요");
  await expect(reply.locator("blockquote")).toHaveCSS(
    "border-left-width",
    "3px",
  );
  await expect(reply.locator("pre code")).toContainText("const vision");
  await expect(reply.locator("del")).toHaveText("너무 이른 실행 계획");
  await expect(reply.getByRole("checkbox").first()).toBeChecked();
  await expect(reply.getByRole("checkbox").first()).toBeDisabled();
  await expect(reply.getByRole("table").getByRole("row")).toHaveCount(3);
  await expect(reply.getByRole("link", { name: "참고 링크" })).toHaveAttribute(
    "target",
    "_blank",
  );
  await expect(reply.getByRole("link", { name: "위험 링크" })).toHaveCount(0);
  await expect(reply.locator("script")).toHaveCount(0);
  expect(
    await page.evaluate(() => globalThis.markdownExecuted),
  ).toBeUndefined();

  await page.reload();
  await page.getByRole("button", { name: /나의 첫 12주/ }).click();
  await page.getByRole("button", { name: "AI와 비전 다듬기" }).click();
  await expect(heading).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const layout = await reply.evaluate((el) => {
    const code = el.querySelector("pre");
    const table = el.querySelector(".markdown-table-scroll");
    return {
      pageFits: document.documentElement.scrollWidth <= innerWidth,
      codeScrolls: code.scrollWidth > code.clientWidth,
      tableScrolls: table.scrollWidth > table.clientWidth,
    };
  });
  expect(layout).toEqual({
    pageFits: true,
    codeScrolls: true,
    tableScrolls: true,
  });
  await page.screenshot({
    path: "test-results/17-markdown-mobile.png",
    fullPage: true,
  });
});
