import { currentToken } from "./sessions.js";
import { withRequestDeadline } from "../../shared/request-deadline.js";
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
  try {
    // AI generation already has a 90s provider deadline; keep that flow usable.
    const timeoutMs = /\/ai\//.test(path)
      ? 120000
      : /\/calendar\//.test(path)
        ? 90000
        : 30000;
    return await withRequestDeadline(async (signal) => {
      const response = await fetch(`${base}/api${path}`, {
        method,
        headers: {
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw Object.assign(
          new Error(data.error || "연결을 확인하고 다시 시도해주세요."),
          { status: response.status, issues: data.issues },
        );
      }
      return await (response.status === 204
        ? null
        : blob
          ? response.blob()
          : response.json());
    }, timeoutMs);
  } catch (error) {
    if (error.code === "REQUEST_TIMEOUT")
      error.message =
        method === "GET"
          ? "서버 응답이 늦어지고 있어요. 잠시 후 다시 시도해주세요."
          : "서버 응답을 확인하지 못했어요. 저장이 반영됐을 수 있으니 다시 불러와 확인한 뒤 시도해주세요.";
    throw error;
  }
}
