import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyPlan, prepareWeek } from "../shared/domain.js";
import { editablePlan } from "../shared/planning.js";
import {
  updateVision,
  visionChoices,
  linkedVisions,
} from "../shared/vision-links.js";
import { planSchema } from "../server/schema.js";

function linkedPlan() {
  let plan = editablePlan({
    ...emptyPlan(),
    personalVision: "회복이 있는 생활\n생활비 이후 저축",
    careerVision: "내 서비스를 운영한다",
  });
  const [personal, career] = [
    plan.visionItems.personalVision[1],
    plan.visionItems.careerVision[0],
  ];
  plan.goals[0].visionLinks = [
    { area: "personalVision", itemId: personal.id, text: personal.text },
    { area: "careerVision", itemId: career.id, text: career.text },
  ];
  return plan;
}

test("legacy visions receive stable IDs without changing text, goals, tactics or input mode", () => {
  const legacy = emptyPlan();
  legacy.personalVision = "첫 비전\n\n두 번째 비전";
  legacy.visionModes.personalVision = "text";
  delete legacy.goals[0].visionLinks;
  const before = structuredClone(legacy),
    normalized = editablePlan(legacy);
  assert.deepEqual(legacy, before);
  assert.equal(normalized.personalVision, legacy.personalVision);
  assert.equal(normalized.visionModes.personalVision, "text");
  assert.deepEqual(
    normalized.goals.map((g) => g.id),
    legacy.goals.map((g) => g.id),
  );
  assert.deepEqual(
    normalized.goals.map((g) => g.tactics),
    legacy.goals.map((g) => g.tactics),
  );
  assert.equal(visionChoices(normalized).length, 2);
  assert.deepEqual(editablePlan(normalized), normalized);
  assert.deepEqual(planSchema.parse(normalized), normalized);
  assert.deepEqual(planSchema.parse(legacy), legacy);
});

test("list insertions, renaming and deletion preserve the identity of linked rows", () => {
  const original = linkedPlan(),
    link = original.goals[0].visionLinks[0];
  let p = updateVision(
    original,
    "personalVision",
    "회복이 있는 생활\n새 비전\n생활비 이후 저축",
    { index: 1, remove: 0, insert: 1 },
  );
  assert.equal(p.visionItems.personalVision[2].id, link.itemId);
  p = updateVision(
    p,
    "personalVision",
    "회복이 있는 생활\n새 비전\n생활비를 내고 300만원 저축",
    { index: 2, remove: 1, insert: 1 },
  );
  assert.equal(p.visionItems.personalVision[2].id, link.itemId);
  assert.equal(
    linkedVisions(p, p.goals[0])[0].text,
    "생활비를 내고 300만원 저축",
  );
  p = updateVision(p, "personalVision", "새 비전\n생활비를 내고 300만원 저축", {
    index: 0,
    remove: 1,
    insert: 0,
  });
  assert.equal(p.visionItems.personalVision[1].id, link.itemId);
  assert.deepEqual(planSchema.parse(p), p);
  assert.equal(original.personalVision, "회복이 있는 생활\n생활비 이후 저축");
});

test("deleted or blank linked items remain visible for review and never move to another item", () => {
  const original = linkedPlan(),
    link = original.goals[0].visionLinks[0];
  let p = updateVision(original, "personalVision", "회복이 있는 생활", {
    index: 1,
    remove: 1,
    insert: 0,
  });
  assert.deepEqual(p.goals[0].visionLinks[0], link);
  assert.equal(linkedVisions(p, p.goals[0])[0].missing, true);
  p = updateVision(p, "personalVision", "회복\n생활비 이후 저축", {
    index: 1,
    remove: 0,
    insert: 1,
  });
  assert.notEqual(p.visionItems.personalVision[1].id, link.itemId);
  assert.equal(linkedVisions(p, p.goals[0])[0].missing, true);
  const blank = updateVision(original, "personalVision", "회복이 있는 생활\n", {
    index: 1,
    remove: 1,
    insert: 1,
  });
  assert.equal(linkedVisions(blank, blank.goals[0])[0].missing, true);
  assert.equal(blank.goals[0].visionLinks[0].text, link.text);
});

test("free text reordering, line insertion and one-line edits retain matching vision links", () => {
  const original = linkedPlan(),
    link = original.goals[0].visionLinks[0];
  let p = updateVision(
    original,
    "personalVision",
    "생활비 이후 저축\n회복이 있는 생활",
  );
  assert.equal(p.visionItems.personalVision[0].id, link.itemId);
  p = updateVision(
    p,
    "personalVision",
    "새 비전\n생활비 이후 저축\n회복이 있는 생활",
  );
  assert.equal(p.visionItems.personalVision[1].id, link.itemId);
  p = updateVision(
    p,
    "personalVision",
    "새 비전\n비상금을 쌓는 생활\n회복이 있는 생활",
  );
  assert.equal(p.visionItems.personalVision[1].id, link.itemId);
  assert.equal(p.goals[0].visionLinks[0].text, "비상금을 쌓는 생활");
});

test("duplicate text in separate list rows keeps separate identities when a row is removed", () => {
  let p = editablePlan({
    ...emptyPlan(),
    personalVision: "동일한 문구\n동일한 문구",
  });
  const second = p.visionItems.personalVision[1];
  p.goals[0].visionLinks = [
    { area: "personalVision", itemId: second.id, text: second.text },
  ];
  p = updateVision(p, "personalVision", "동일한 문구", {
    index: 0,
    remove: 1,
    insert: 0,
  });
  assert.equal(p.visionItems.personalVision[0].id, second.id);
  assert.equal(linkedVisions(p, p.goals[0])[0].missing, false);
});

test("ambiguous multi-paragraph rewrites require review instead of silently reassigning links", () => {
  const p = linkedPlan();
  const rewritten = updateVision(
    p,
    "personalVision",
    "전혀 새로운 첫 모습\n전혀 새로운 두 번째 모습",
  );
  assert.equal(linkedVisions(rewritten, rewritten.goals[0])[0].missing, true);
  assert.equal(
    linkedVisions(rewritten, rewritten.goals[0])[0].text,
    "생활비 이후 저축",
  );
});

test("vision links alone do not turn a blank goal into a scored execution commitment", () => {
  const p = linkedPlan(),
    baseline = prepareWeek(p, "2026-10-12", 1);
  assert.equal(baseline.goals.length, 0);
  assert.equal(baseline.occurrences.length, 0);
  p.goals[0].title = "실행";
  Object.assign(p.goals[0].tactics[0], {
    title: "행동",
    condition: "완료 조건",
  });
  const withLinks = prepareWeek(p, "2026-10-12", 1);
  delete p.goals[0].visionLinks;
  assert.deepEqual(prepareWeek(p, "2026-10-12", 1), withLinks);
});

test("schema preserves optional links, permits deleted references and rejects corrupt metadata", () => {
  const p = linkedPlan();
  const invalid = (edit) => {
    const copy = structuredClone(p);
    edit(copy);
    assert.equal(planSchema.safeParse(copy).success, false);
  };
  invalid((copy) =>
    copy.goals[0].visionLinks.push(copy.goals[0].visionLinks[0]),
  );
  invalid((copy) => (copy.goals[0].visionLinks[0].area = "longVision"));
  invalid((copy) => (copy.goals[0].visionLinks[0].itemId = "bad-id"));
  invalid(
    (copy) =>
      (copy.visionItems.careerVision[0].id =
        copy.visionItems.personalVision[0].id),
  );
  invalid((copy) => (copy.personalVision = "내용 불일치"));
  const deleted = updateVision(p, "personalVision", "회복이 있는 생활", {
    index: 1,
    remove: 1,
    insert: 0,
  });
  assert.deepEqual(planSchema.parse(deleted), deleted);
});
