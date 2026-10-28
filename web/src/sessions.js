const rememberedKey = "twelve.remembered-sessions";
const activeKey = "twelve.token";
const tabKey = "twelve.tab-token";
const validId =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validToken = /^[A-Za-z0-9_-]{43}$/;

function remembered() {
  const result = {};
  try {
    const saved = JSON.parse(localStorage.getItem(rememberedKey));
    if (!saved || typeof saved !== "object" || Array.isArray(saved))
      return result;
    for (const [id, entry] of Object.entries(saved).slice(0, 200)) {
      if (!validId.test(id) || !validToken.test(entry?.token || "")) continue;
      if (
        entry.expiresAt != null &&
        (!Number.isFinite(Date.parse(entry.expiresAt)) ||
          Date.parse(entry.expiresAt) <= Date.now())
      )
        continue;
      result[id] = { token: entry.token, expiresAt: entry.expiresAt ?? null };
    }
  } catch {
    /* A damaged cache must not prevent password login. */
  }
  return result;
}

export function currentToken() {
  // Pin each tab to its own account. Choosing another user in one tab must not
  // silently send a different account's token from an already-open tab.
  const pinned = sessionStorage.getItem(tabKey);
  if (pinned === null) return localStorage.getItem(activeKey);
  return pinned &&
    Object.values(remembered()).some((entry) => entry.token === pinned)
    ? pinned
    : null;
}

export function rememberedSession(profileId) {
  return remembered()[profileId] ?? null;
}

export function activateSession({ token, profile, expiresAt }) {
  if (!validToken.test(token || "") || !validId.test(profile?.id || ""))
    throw new Error("로그인 정보를 확인해주세요.");
  const saved = remembered();
  const previous = saved[profile.id];
  saved[profile.id] = {
    token,
    expiresAt:
      expiresAt ?? (previous?.token === token ? previous.expiresAt : null),
  };
  // Store authentication tokens only. Passwords and profile contents are absent.
  localStorage.setItem(rememberedKey, JSON.stringify(saved));
  localStorage.setItem(activeKey, token);
  sessionStorage.setItem(tabKey, token);
}

export function selectAnotherProfile() {
  // An explicit picker stays open on refresh, without revoking remembered logins.
  sessionStorage.setItem(tabKey, "");
}

export function forgetCurrentSession(profileId) {
  const current = currentToken();
  const saved = remembered();
  const cached = profileId ? saved[profileId]?.token : null;
  for (const [id, entry] of Object.entries(saved))
    if (id === profileId || entry.token === current) delete saved[id];
  if (Object.keys(saved).length)
    localStorage.setItem(rememberedKey, JSON.stringify(saved));
  else localStorage.removeItem(rememberedKey);
  const last = localStorage.getItem(activeKey);
  if (last === current || last === cached) localStorage.removeItem(activeKey);
  selectAnotherProfile();
}

export function forgetRememberedSession(profileId) {
  const saved = remembered();
  const cached = saved[profileId]?.token;
  delete saved[profileId];
  localStorage.setItem(rememberedKey, JSON.stringify(saved));
  if (cached && localStorage.getItem(activeKey) === cached)
    localStorage.removeItem(activeKey);
}
