import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
// OWASP's 16 MiB / p=5 scrypt configuration fits the 512 MiB API instance.
const options = { N: 16384, r: 8, p: 5, maxmem: 32 * 1024 * 1024 };
const prefix = "scrypt$16384$8$5";
const dummySalt = Buffer.alloc(16, 0);

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64, options);
  return `${prefix}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password, encoded) {
  const parts = typeof encoded === "string" ? encoded.split("$") : [];
  const valid =
    parts.length === 6 &&
    parts.slice(0, 4).join("$") === prefix &&
    /^[A-Za-z0-9_-]{22}$/.test(parts[4]) &&
    /^[A-Za-z0-9_-]{86}$/.test(parts[5]);
  // Unknown users and invalid hashes still perform the normal password work.
  const salt = valid ? Buffer.from(parts[4], "base64url") : dummySalt;
  const expected = valid
    ? Buffer.from(parts[5], "base64url")
    : Buffer.alloc(64);
  const actual = await scrypt(password, salt, 64, options);
  return valid && timingSafeEqual(actual, expected);
}
