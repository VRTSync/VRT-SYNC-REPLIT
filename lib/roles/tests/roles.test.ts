import assert from "node:assert/strict";
import { test } from "node:test";
import { ROLES, ROLE_LABELS, roleLabel } from "../src/index.ts";
import { userRoleEnum } from "../../db/src/schema/schema.ts";

test("requested role values match the database enum without reordering either list", () => {
  assert.equal(new Set(ROLES).size, ROLES.length, "duplicate shared role");
  assert.equal(new Set(userRoleEnum.enumValues).size, userRoleEnum.enumValues.length, "duplicate database role");
  assert.equal(ROLES.length, userRoleEnum.enumValues.length);
  assert.deepEqual(new Set(ROLES), new Set(userRoleEnum.enumValues));
  assert.deepEqual(Object.keys(ROLE_LABELS).sort(), [...ROLES].sort());
});

test("role labels have a safe unknown fallback", () => {
  assert.equal(roleLabel("contractor_manager"), "Account Manager");
  for (const value of [null, undefined, "", "unknown", "toString", "__proto__"]) {
    assert.equal(roleLabel(value), "User");
  }
});
