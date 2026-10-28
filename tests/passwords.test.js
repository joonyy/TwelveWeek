import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../server/passwords.js";

test("passwords use individual salts and verify without storing the original value", async () => {
  const first = await hashPassword("1234");
  const second = await hashPassword("1234");
  assert.notEqual(first, second);
  assert.ok(!first.includes("1234"));
  assert.equal(await verifyPassword("1234", first), true);
  assert.equal(await verifyPassword("wrong", first), false);
});

test("missing, damaged and unsupported hashes never grant access", async () => {
  for (const value of [undefined, "1234", "scrypt$1048576$8$5$invalid$invalid"])
    assert.equal(await verifyPassword("1234", value), false);
});

test("password verification keeps Unicode, spaces and case significant", async () => {
  const value = " 비밀번호-AbC ";
  const encoded = await hashPassword(value);
  assert.equal(await verifyPassword(value, encoded), true);
  assert.equal(await verifyPassword(value.trim(), encoded), false);
  assert.equal(await verifyPassword(value.toLowerCase(), encoded), false);
});
