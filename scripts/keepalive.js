// External cron entrypoint. No credentials required; health is read-only.
const urls = (process.env.KEEPALIVE_URLS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (!urls.length)
  throw new Error(
    "Set KEEPALIVE_URLS to API /api/health URL (optionally also frontend URL).",
  );
const results = await Promise.allSettled(
  urls.map(async (value) => {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol))
      throw new Error("HTTP(S) required");
    const response = await fetch(url, { signal: AbortSignal.timeout(90_000) });
    if (!response.ok) throw new Error(`${url.origin}: HTTP ${response.status}`);
    console.log(`OK ${url.origin}${url.pathname}`);
  }),
);
for (const result of results)
  if (result.status === "rejected") {
    console.error(result.reason.message);
    process.exitCode = 1;
  }
