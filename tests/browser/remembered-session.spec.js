import { test, expect } from "@playwright/test";
const password = "remembered-session-test";
const home = (page) =>
  page.getByRole("heading", { name: "나의 12주", exact: true });
async function register(page, prefix) {
  const name = `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  await page.getByLabel("새 유저 이름").fill(name);
  await page.getByLabel("새 유저 비밀번호").fill(password);
  await page.getByRole("button", { name: "나의 공간 만들기" }).click();
  await expect(home(page)).toBeVisible();
  const token = await page.evaluate(() => localStorage.getItem("twelve.token"));
  return { name, token };
}
const pick = (page, name) =>
  page.getByRole("button", { name: new RegExp(name) }).click();

test("remembered login survives switching, reload and a restored browser, while a new device still requires a password", async ({
  page,
  context,
  browser,
}) => {
  await page.goto("/");
  const a = await register(page, "로그인 유지");
  await page.getByRole("button", { name: "유저 전환", exact: true }).click();
  await expect(
    page.getByRole("button", { name: new RegExp(a.name) }),
  ).toContainText("이 기기에 로그인됨");
  await pick(page, a.name);
  await expect(home(page)).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(home(page)).toBeVisible();
  const restored = await browser.newContext({
    storageState: await context.storageState(),
  });
  try {
    const reopened = await restored.newPage();
    await reopened.goto("http://127.0.0.1:5179/");
    await expect(home(reopened)).toBeVisible();
  } finally {
    await restored.close();
  }
  const fresh = await browser.newContext();
  try {
    const other = await fresh.newPage();
    await other.goto("http://127.0.0.1:5179/");
    await pick(other, a.name);
    await expect(other.getByLabel("비밀번호", { exact: true })).toBeVisible();
  } finally {
    await fresh.close();
  }
  expect(
    await page.evaluate(
      (p) => JSON.stringify({ ...localStorage, ...sessionStorage }).includes(p),
      password,
    ),
  ).toBe(false);
});

test("account switching remembers both users and pins each open tab to the right account", async ({
  page,
  context,
  request,
}) => {
  await page.goto("/");
  const a = await register(page, "계정 A");
  const tabA = await context.newPage();
  await tabA.goto("http://127.0.0.1:5179/");
  await expect(home(tabA)).toBeVisible();
  await page.getByRole("button", { name: "유저 전환", exact: true }).click();
  const b = await register(page, "계정 B");
  await tabA.reload();
  await expect(tabA.locator(".profile strong")).toHaveText(a.name);
  await expect(page.locator(".profile strong")).toHaveText(b.name);
  // Reloading A changed the browser's last active account. B must still save as B.
  await page.getByRole("button", { name: "첫 12주 작성하기" }).click();
  await page.getByLabel("이번 12주의 이름").fill("B 소유 초안");
  await page.getByRole("button", { name: "비전부터 작성하기" }).click();
  await expect(page).toHaveURL(/cycle=/);
  const id = new URLSearchParams(new URL(page.url()).hash.slice(1)).get(
    "cycle",
  );
  expect(
    (
      await request.get(`http://127.0.0.1:4111/api/cycles/${id}`, {
        headers: { Authorization: `Bearer ${b.token}` },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await request.get(`http://127.0.0.1:4111/api/cycles/${id}`, {
        headers: { Authorization: `Bearer ${a.token}` },
      })
    ).status(),
  ).toBe(404);
  await page.getByRole("button", { name: "유저 전환", exact: true }).click();
  await pick(page, a.name);
  await expect(page.locator(".profile strong")).toHaveText(a.name);
  await page.getByRole("button", { name: "유저 전환", exact: true }).click();
  await pick(page, b.name);
  await expect(page.locator(".profile strong")).toHaveText(b.name);
  await tabA.close();
});

test("explicit logout clears only that remembered account even if the network request fails", async ({
  page,
}) => {
  await page.goto("/");
  const a = await register(page, "남겨둘 계정");
  await page.getByRole("button", { name: "유저 전환", exact: true }).click();
  const b = await register(page, "로그아웃 계정");
  await page.route("**/api/sessions/current", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "연결 실패 시험" }),
    }),
  );
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "유저를 선택하세요.", exact: true }),
  ).toBeVisible();
  await pick(page, b.name);
  await expect(page.getByLabel("비밀번호", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await pick(page, a.name);
  await expect(page.locator(".profile strong")).toHaveText(a.name);
});

test("revoked remembered sessions prompt for the password instead of silently selecting another account", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const a = await register(page, "만료 검사");
  await page.getByRole("button", { name: "유저 전환", exact: true }).click();
  expect(
    (
      await request.delete("http://127.0.0.1:4111/api/sessions/current", {
        headers: { Authorization: `Bearer ${a.token}` },
      })
    ).status(),
  ).toBe(204);
  await pick(page, a.name);
  await expect(page.getByLabel("비밀번호", { exact: true })).toBeFocused();
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(home(page)).toBeVisible();
});

test("a damaged or mismatched remembered account cannot authenticate as another user", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const a = await register(page, "이름 매칭 A");
  await page.getByRole("button", { name: "유저 전환", exact: true }).click();
  const b = await register(page, "이름 매칭 B");
  await page.getByRole("button", { name: "유저 전환", exact: true }).click();
  const profiles = await (
    await request.get("http://127.0.0.1:4111/api/profiles")
  ).json();
  const aid = profiles.find((p) => p.name === a.name).id;
  await page.evaluate(
    ({ id, other }) => {
      const saved = JSON.parse(
        localStorage.getItem("twelve.remembered-sessions"),
      );
      saved[id].token = other;
      localStorage.setItem("twelve.remembered-sessions", JSON.stringify(saved));
    },
    { id: aid, other: b.token },
  );
  await pick(page, a.name);
  await expect(
    page.getByRole("dialog", { name: `${a.name} 로그인` }),
  ).toBeVisible();
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await pick(page, b.name);
  await expect(page.locator(".profile strong")).toHaveText(b.name);
});
