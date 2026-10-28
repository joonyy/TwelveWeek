import { createHash, timingSafeEqual } from "node:crypto";
import { rateLimit } from "express-rate-limit";

// A private installation keeps the existing profile/session model. The entry
// key is required only to list/create profiles or issue a new device session.
// Existing bearer sessions continue to work without retaining the entry key.
export function mountPrivateAccess(app, { accessHash, rateLimits = true }) {
  if (accessHash && !/^[a-f0-9]{64}$/i.test(accessHash))
    throw new Error("PRIVATE_ACCESS_KEY_SHA256 must be a SHA-256 hex digest");
  app.get("/api/access", (req, res) => {
    res.set("Cache-Control", "no-store").json({ required: !!accessHash });
  });
  if (!accessHash) return;
  const expected = Buffer.from(accessHash, "hex");
  const limiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 30,
    skipSuccessfulRequests: true,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "접속 시도가 많아요. 잠시 후 다시 시도해주세요." },
  });
  function requireKey(req, res, next) {
    const supplied = req.get("X-Private-Access-Key") || "";
    const actual = createHash("sha256").update(supplied).digest();
    if (!timingSafeEqual(actual, expected))
      return res
        .status(403)
        .set("Cache-Control", "no-store")
        .json({ error: "개인 공간의 접속키를 확인해주세요." });
    next();
  }
  const guards = rateLimits ? [limiter, requireKey] : [requireKey];
  app.all("/api/profiles", ...guards);
  app.post("/api/sessions", ...guards);
}
