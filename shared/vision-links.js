const uid = () => crypto.randomUUID();
export const VISION_AREAS = [
  { key: "personalVision", label: "개인 생활" },
  { key: "careerVision", label: "커리어" },
];

// Strings remain compatible with older plans. IDs give their rows stable identity.
export function visionItems(value, previous = [], edit) {
  const lines = value.split("\n");
  if (edit) {
    const { index, remove, insert, preserve = true } = edit;
    const rows = [
      ...previous.slice(0, index),
      ...lines.slice(index, index + insert).map((text, i) => ({
        id:
          i === 0 && remove && preserve
            ? (previous[index]?.id ?? uid())
            : uid(),
        text,
      })),
      ...previous.slice(index + remove),
    ];
    if (rows.map((row) => row.text).join("\n") === value) return rows;
  }
  if (previous.map((row) => row.text).join("\n") === value && previous.length)
    return previous.map((row) => ({ ...row }));

  // Free text / legacy edits: retain exact, unambiguous matches first.
  const byText = new Map(),
    counts = new Map();
  for (const row of previous)
    byText.set(row.text, [...(byText.get(row.text) ?? []), row]);
  for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1);
  const used = new Set();
  const rows = lines.map((text) => {
    const matches = byText.get(text) ?? [];
    if (matches.length !== 1 || counts.get(text) !== 1) return { text };
    used.add(matches[0].id);
    return { id: matches[0].id, text };
  });
  const unmatched = previous.filter((row) => !used.has(row.id));
  const gaps = rows.filter((row) => !row.id);
  // A one-line replacement is an edit. Ambiguous rewrites get new IDs for review.
  gaps.forEach((row, i) => {
    row.id =
      gaps.length === 1 && unmatched.length === 1 ? unmatched[i].id : uid();
  });
  return rows;
}

export function updateVision(plan, area, value, edit) {
  const previous = visionItems(plan[area], plan.visionItems?.[area]);
  const items = visionItems(value, previous, edit);
  const current = new Map(items.map((item) => [item.id, item.text]));
  return {
    ...plan,
    [area]: value,
    visionItems: { ...plan.visionItems, [area]: items },
    goals: plan.goals.map((goal) => ({
      ...goal,
      visionLinks: (goal.visionLinks ?? []).map((link) =>
        link.area === area && current.get(link.itemId)?.trim()
          ? { ...link, text: current.get(link.itemId) }
          : link,
      ),
    })),
  };
}

export function visionChoices(plan) {
  return VISION_AREAS.flatMap(({ key, label }) =>
    (plan.visionItems?.[key] ?? [])
      .map((item, index) => ({ ...item, area: key, label, number: index + 1 }))
      .filter((item) => item.text.trim()),
  );
}

export function linkedVisions(plan, goal) {
  const choices = visionChoices(plan);
  return (goal.visionLinks ?? []).map((link) => {
    const item = choices.find(
      (item) => item.area === link.area && item.id === link.itemId,
    );
    return item
      ? { ...item, missing: false }
      : {
          id: link.itemId,
          area: link.area,
          text: link.text,
          label: VISION_AREAS.find((area) => area.key === link.area)?.label,
          missing: true,
        };
  });
}
