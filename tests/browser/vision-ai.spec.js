import { test, expect } from "@playwright/test";

test("vision partner imports, resumes, asks, edits with permission and undoes on mobile", async ({
  page,
}, testInfo) => {
  const errors = [];
  let configLoads = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/ai/config")) configLoads++;
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page
    .getByLabel("새 유저 이름")
    .fill(`비전 AI 사용자 ${testInfo.repeatEachIndex}`);
  await page.getByRole("button", { name: "나의 공간 만들기" }).click();
  await page.getByRole("button", { name: "첫 12주 작성하기" }).click();
  await page.getByRole("button", { name: "비전부터 작성하기" }).click();
  const vision = page.getByRole("textbox", {
    name: "장기 비전 1",
    exact: true,
  });
  await vision.fill("선택에 있어 가격을 고민하지 않는 삶을 살고 싶다.");
  await page.getByRole("button", { name: "AI와 비전 다듬기" }).click();
  await expect(
    page.getByRole("button", { name: "질문 하나로 시작하기" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "저장하고 대화 준비" }).click();
  await expect(
    page.getByRole("button", { name: "질문 하나로 시작하기" }),
  ).toBeEnabled();
  expect(configLoads).toBe(1);
  await page.getByRole("button", { name: "질문 하나로 시작하기" }).click();
  await expect(page.getByRole("log")).toContainText(
    "가격 때문에 포기하고 싶지 않은 선택",
  );
  expect(configLoads).toBe(3);
  await expect(vision).toHaveValue(
    "선택에 있어 가격을 고민하지 않는 삶을 살고 싶다.",
  );
  await page.getByLabel("AI의 장기비전 직접 수정 허용").check();
  await page
    .getByLabel("AI에게 보낼 메시지")
    .fill("사랑하는 사람과의 경험이 중요해. 비전에 반영해줘.");
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect(vision).toHaveValue(
    "소중한 사람과의 경험을 가격 때문에 포기하지 않는 삶",
  );
  await page.getByRole("tab", { name: "수정 이력", exact: true }).click();
  await page.getByRole("button", { name: "이 수정 되돌리기" }).first().click();
  await expect(vision).toHaveValue(
    "선택에 있어 가격을 고민하지 않는 삶을 살고 싶다.",
  );
  await page.reload();
  await page.getByRole("button", { name: /나의 첫 12주/ }).click();
  await page.getByRole("button", { name: "AI와 비전 다듬기" }).click();
  await expect(page.getByRole("log")).toContainText("사랑하는 사람과의 경험");
  await expect(page.getByLabel("AI의 장기비전 직접 수정 허용")).toBeChecked();
  await page.getByLabel("AI의 장기비전 직접 수정 허용").uncheck();
  await page.getByRole("tab", { name: "연결", exact: true }).click();
  await page
    .getByRole("button", { name: "대화 가져오기", exact: true })
    .click();
  await page.getByLabel("원래 대화 서비스").selectOption("Claude");
  await page
    .getByLabel("대화 내용 또는 요약")
    .fill("이전 Claude 대화: 나는 누군가에게 길잡이가 되는 삶을 원한다.");
  await page
    .getByRole("button", { name: "선택한 내용으로 대화 만들기" })
    .click();
  await expect(page.getByRole("log")).toContainText("길잡이가 되는 삶");
  await expect(
    page.getByText("Claude 대화 내용을 가져온 별도의 대화예요.", {
      exact: false,
    }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "test-results/16-vision-ai-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("AI에게 보낼 메시지")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/15-vision-ai-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("external AI edits do not overwrite an unsaved local vision", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page
    .getByLabel("새 유저 이름")
    .fill(`비전 충돌 사용자 ${testInfo.repeatEachIndex}`);
  await page.getByRole("button", { name: "나의 공간 만들기" }).click();
  await page.getByRole("button", { name: "첫 12주 작성하기" }).click();
  await page.getByRole("button", { name: "비전부터 작성하기" }).click();
  const vision = page.getByRole("textbox", {
    name: "장기 비전 1",
    exact: true,
  });
  await vision.fill("처음 저장 비전");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await page.getByRole("button", { name: "AI와 비전 다듬기" }).click();
  await expect(
    page.getByRole("button", { name: "질문 하나로 시작하기" }),
  ).toBeEnabled();
  const external = await page.evaluate(async () => {
    const headers = {
      Authorization: `Bearer ${localStorage.getItem("twelve.token")}`,
      "Content-Type": "application/json",
    };
    const cycles = await (await fetch("/api/cycles", { headers })).json();
    const c = await (
      await fetch(`/api/cycles/${cycles[0].id}`, { headers })
    ).json();
    return { id: c.id, version: c.version };
  });
  await vision.fill("내가 아직 저장하지 않은 비전");
  await page.evaluate(async (c) => {
    await fetch(`/api/ai/cycles/${c.id}/vision`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${localStorage.getItem("twelve.token")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version: c.version,
        vision: "외부 AI에서 저장한 비전",
      }),
    });
  }, external);
  await expect(
    page.getByRole("button", { name: "최신 저장 내용 불러오기" }),
  ).toBeVisible({ timeout: 12000 });
  await expect(vision).toHaveValue("내가 아직 저장하지 않은 비전");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "최신 저장 내용 불러오기" }).click();
  await expect(vision).toHaveValue("외부 AI에서 저장한 비전");
});

test("external MCP OAuth shows the actual client and selected-cycle permissions", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page
    .getByLabel("새 유저 이름")
    .fill(`AI 연결 승인 사용자 ${testInfo.repeatEachIndex}`);
  await page.getByRole("button", { name: "나의 공간 만들기" }).click();
  await page.getByRole("button", { name: "첫 12주 작성하기" }).click();
  await page.getByRole("button", { name: "비전부터 작성하기" }).click();
  const c = await page.request.post("http://127.0.0.1:4111/oauth/register", {
    data: {
      client_name: "내 외부 AI",
      redirect_uris: ["https://example.com/callback"],
    },
  });
  const client = await c.json();
  const params = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: "https://example.com/callback",
    response_type: "code",
    code_challenge: "x".repeat(43),
    code_challenge_method: "S256",
    scope: "vision:read vision:write",
    resource: "http://127.0.0.1:4111/mcp",
    state: "my-state",
  });
  const r = await page.request.get(
    `http://127.0.0.1:4111/oauth/authorize?${params}`,
    { maxRedirects: 0 },
  );
  expect(r.status()).toBe(302);
  await page.goto(r.headers().location);
  await expect(
    page.getByRole("heading", { name: "외부 AI에 비전 연결" }),
  ).toBeVisible();
  await expect(page.getByText("내 외부 AI", { exact: true })).toBeVisible();
  await expect(page.getByLabel("연결할 실행 주기")).toContainText(
    "나의 첫 12주",
  );
  await expect(
    page.getByText("목표·전술·점수 접근은 포함하지 않아요.", { exact: false }),
  ).toBeVisible();
  await page.route("https://example.com/callback?**", (route) =>
    route.fulfill({ body: "Test callback" }),
  );
  await page.getByRole("button", { name: "이 주기 연결 허용" }).click();
  await page.waitForURL("https://example.com/callback?**");
  const callback = new URL(page.url());
  expect(callback.searchParams.get("state")).toBe("my-state");
  expect(callback.searchParams.get("code")).toHaveLength(43);
});
