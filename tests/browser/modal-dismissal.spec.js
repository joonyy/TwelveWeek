import { test, expect } from "@playwright/test";
import { emptyPlan } from "../../shared/domain.js";

async function dragFromFieldToBackdrop(page, field) {
  const box = await field.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box.x + box.width - 12, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(8, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
}

test("dragging text from a cycle-name input onto the backdrop keeps the modal and its value", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByLabel("새 유저 이름")
    .fill(`팝업 드래그-${crypto.randomUUID().slice(0, 8)}`);
  await page.getByLabel("새 유저 비밀번호").fill("test-password");
  await page.getByRole("button", { name: "나의 공간 만들기" }).click();
  await page.getByRole("button", { name: "첫 12주 작성하기" }).click();
  const modal = page.getByRole("dialog", { name: "새로운 12주" });
  const field = modal.getByLabel("이번 12주의 이름");
  await field.fill("드래그해도 사라지지 않을 초안 이름");
  await dragFromFieldToBackdrop(page, field);
  await expect(modal).toBeVisible();
  await expect(field).toHaveValue("드래그해도 사라지지 않을 초안 이름");

  // A gesture starting outside and ending inside is not an outside click either.
  const box = await field.boundingBox();
  await page.mouse.move(8, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 20, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(modal).toBeVisible();

  await page.mouse.click(8, 8);
  await expect(modal).toHaveCount(0);
  await page.getByRole("button", { name: "첫 12주 작성하기" }).click();
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
  await page.getByRole("button", { name: "첫 12주 작성하기" }).click();
  await modal.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(modal).toHaveCount(0);
});

test("reading-note textarea selection survives a release outside the dialog without saving or changing scores", async ({
  page,
  request,
}) => {
  const base = "http://127.0.0.1:4111/api";
  const profile = await (
    await request.post(`${base}/profiles`, {
      data: {
        name: `독서 팝업-${crypto.randomUUID().slice(0, 8)}`,
        password: "test-password",
      },
    })
  ).json();
  const { token } = await (
    await request.post(`${base}/sessions`, {
      data: { profileId: profile.id, password: "test-password" },
    })
  ).json();
  const headers = { Authorization: `Bearer ${token}` };
  const plan = emptyPlan(2);
  plan.goals[0].title = "독서";
  Object.assign(plan.goals[0].tactics[0], {
    title: "단원 읽기",
    condition: "한 줄 생각",
    readingBook: "세컨드 브레인",
    weeks: [1, 2],
    count: 1,
  });
  let cycle = await (
    await request.post(`${base}/cycles`, {
      headers,
      data: {
        title: "팝업 기록 보존",
        startDate: "2026-10-05",
        weekCount: 2,
        plan,
      },
    })
  ).json();
  cycle = await (
    await request.post(`${base}/cycles/${cycle.id}/start`, {
      headers,
      data: { version: cycle.version },
    })
  ).json();
  const weekUrl = `${base}/cycles/${cycle.id}/weeks/1`;
  let week = await (await request.get(weekUrl, { headers })).json();
  week = await (
    await request.put(
      `${weekUrl}/occurrences/${week.state.occurrences[0].id}/schedule`,
      {
        headers,
        data: {
          version: week.version,
          date: week.today,
          time: "10:00",
          minutes: 30,
        },
      },
    )
  ).json();
  await page.clock.setFixedTime(new Date("2026-10-07T12:00:00+09:00"));
  await page.addInitScript(
    (value) => localStorage.setItem("twelve.token", value),
    token,
  );
  await page.goto(
    `/#cycle=${cycle.id}&view=week&week=1&mode=day&day=2026-10-07`,
  );
  await page
    .getByRole("button", { name: "단원 읽기 독서 기록", exact: true })
    .click();
  const modal = page.getByRole("dialog", { name: "독서 기록", exact: true });
  await modal.getByLabel("읽은 단원", { exact: true }).fill("1장");
  const thought = modal.getByLabel("한 줄 생각", { exact: true });
  await thought.fill("드래그 중에도 남아야 할 생각\n다음 줄도 보존한다.");
  const writes = [];
  page.on("request", (r) => {
    if (["POST", "PUT", "DELETE"].includes(r.method())) writes.push(r.url());
  });
  await dragFromFieldToBackdrop(page, thought);
  await expect(modal).toBeVisible();
  await expect(thought).toHaveValue(
    "드래그 중에도 남아야 할 생각\n다음 줄도 보존한다.",
  );
  expect(writes).toEqual([]);
  const after = await (await request.get(weekUrl, { headers })).json();
  expect(after.state).toEqual(week.state);
  expect(after.score).toEqual(week.score);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(modal).toBeVisible();
  await page.mouse.click(3, 3);
  await expect(modal).toHaveCount(0);
});
