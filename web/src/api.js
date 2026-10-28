import { currentToken } from "./sessions.js";
const base = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
export function token() {
  return currentToken();
}
export async function api(
  path,
  { method = "GET", body, blob = false, authToken = token() } = {},
) {
  // During a rolling deploy the new web bundle can reach the old API briefly.
  // Do not let an older plan schema silently strip template definitions.
  if (
    method === "PUT" &&
    body?.plan &&
    (body.plan.dayTemplates !== undefined ||
      body.plan.modelWeekMode !== undefined ||
      [
        ...(body.plan.modelWeek || []),
        ...(body.plan.weeklyModelWeeks || []).flatMap((w) => w.blocks),
      ].some((b) => b.templateOrigin))
  ) {
    const health = await api("/health", { authToken });
    if (health.features?.dayTemplates !== 1)
      throw new Error(
        "하루 템플릿 서버가 아직 업데이트 중입니다. 입력을 유지한 채 잠시 후 다시 저장해주세요.",
      );
  }
  const response = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw Object.assign(
      new Error(data.error || "연결을 확인하고 다시 시도해주세요."),
      { status: response.status, issues: data.issues },
    );
  }
  return response.status === 204
    ? null
    : blob
      ? response.blob()
      : response.json();
}
