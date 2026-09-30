const base = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
export function token() {
  return localStorage.getItem("twelve.token");
}
export async function api(path, { method = "GET", body, blob = false } = {}) {
  const response = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
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
