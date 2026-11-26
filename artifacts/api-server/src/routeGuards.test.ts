import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";

type Exception = { file: string; text: string; reason: string };

// Exact whole lines, in one file only. These are not caller authorization:
// response selection and target-account validation were retained by earlier slices.
const exceptions: Exception[] = [
  {
    file: "tasks.ts",
    text: '      if (vmRole === "contractor") {',
    reason: "Selects the already-authorized task view-model response collections.",
  },
  {
    file: "tasks.ts",
    text: '      } else if (vmRole === "hoa_member") {',
    reason: "Selects the already-authorized HOA view-model response collections.",
  },
  {
    file: "assets.ts",
    text: "        communityId, userId: reqUser.id, role: reqUser.role,",
    reason: "Passes the viewer role to storage for quality-response shaping after the policy gate.",
  },
  {
    file: "users.ts",
    text: "          allUsers = allUsers.filter(u => u.role === roleFilter);",
    reason: "Filters returned accounts by the requested role after policy grants the all-users view.",
  },
  {
    file: "users.ts",
    text: '      const effectiveCompanyId = companyId === undefined && isContractorSide(targetUser?.role || "") && isContractorSide(role)',
    reason: "Validates the target account's company across role transitions, not the caller's access.",
  },
  {
    file: "users.ts",
    text: "      if (isClientRole(role) && !organizationId) {",
    reason: "Requires an organization for the new target account's client role.",
  },
  {
    file: "users.ts",
    text: "      if (!isClientRole(role) && organizationId) {",
    reason: "Rejects an organization on a non-client target account.",
  },
  {
    file: "users.ts",
    text: "        organizationId: isClientRole(role) ? organizationId : undefined,",
    reason: "Shapes the new target account's organization field, not caller authorization.",
  },
];

const forbidden = [
  { name: "direct role comparison", pattern: /\.role\s*(?:===|!==)/g },
  { name: "role-list check", pattern: /\.includes\s*\(\s*(?:user\.role\b|actor\.role\b|req\.currentUser\b)/g },
  { name: "role predicate", pattern: /\b(?:isHoaRole|isClientRole|isMapCreatorRole|isContractorSide)\s*\(/g },
  { name: "membership or legacy helper", pattern: /\b(?:isUserMemberOfCommunity|userCanAccessCommunity|canUserAccessTask)\s*\(/g },
  { name: "direct policy-submodule import", pattern: /\bfrom\s*["']\.\.\/policy\//g },
  // Track these documented response-only uses too, rather than leaving broad
  // exceptions for arbitrary comparisons or viewer-role arguments.
  { name: "view-model role comparison", pattern: /\bvmRole\s*(?:===|!==)/g },
  { name: "quality viewer role", pattern: /\brole:\s*reqUser\.role\b/g },
];

function violations(file: string, source: string, allowlist: readonly Exception[]): string[] {
  const errors: string[] = [];
  const lines = source.split("\n");
  for (const entry of allowlist.filter(entry => entry.file === file)) {
    const matches = lines.flatMap((line, index) => line === entry.text ? [index] : []);
    if (!entry.reason.trim() || matches.length !== 1) {
      errors.push(`${file}: stale or ambiguous allowlist entry (expected one exact line): ${entry.text}`);
    } else {
      // Mask just this complete line, never the file or an arbitrary substring.
      lines[matches[0]] = " ".repeat(entry.text.length);
    }
  }
  const scanned = lines.join("\n");
  for (const { name, pattern } of forbidden) {
    for (const match of scanned.matchAll(pattern)) {
      const line = scanned.slice(0, match.index).split("\n").length;
      errors.push(`${file}:${line}: ${name}: ${match[0]} — use the central policy module`);
    }
  }
  return errors;
}

const excluded = new Set(["handler.ts", "upload.ts", "errors.ts", "userRules.ts"]);
function routeFiles(directory: URL, prefix = "", exclusions = excluded): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = `${prefix}${entry.name}`;
    if (entry.isDirectory()) return routeFiles(new URL(`${entry.name}/`, directory), `${file}/`, exclusions);
    return entry.isFile() && entry.name.endsWith(".ts") && !exclusions.has(file) ? [file] : [];
  }).sort();
}

const sessionScope = /\bsession\s*(?:\??\.\s*(?:hoaCommunityId|organizationId)\b|\??\.?\s*\[\s*["'](?:hoaCommunityId|organizationId)["']\s*\])/g;

describe("live-record scope source guard", () => {
  it("rejects session scope throughout every route and policy file, including infrastructure", () => {
    const errors: string[] = [];
    for (const directory of ["routes", "policy"]) {
      const root = new URL(`./${directory}/`, import.meta.url);
      for (const file of routeFiles(root, "", new Set())) {
        const source = readFileSync(new URL(file, root), "utf8");
        for (const match of source.matchAll(sessionScope)) errors.push(`${directory}/${file}: ${match[0]}`);
      }
    }
    assert.deepEqual(errors, [], `Session-scope guard failed:\n${errors.join("\n")}`);
  });
  for (const probe of [
    "req.session.hoaCommunityId", "req.session.organizationId",
    "req.session?.hoaCommunityId", 'req.session["organizationId"]',
    "req.session?.['hoaCommunityId']",
  ]) it(`detects ${probe}`, () => assert.equal([...probe.matchAll(sessionScope)].length, 1));
});

describe("route-wide central permission guard", () => {
  it("scans every route file except the four named infrastructure modules", () => {
    const files = routeFiles(new URL("./routes/", import.meta.url));
    assert.ok(files.length > 0, "No route files were scanned");
    const errors = exceptions.filter(entry => !files.includes(entry.file))
      .map(entry => `${entry.file}: stale allowlist file`);
    for (const file of files) {
      const source = readFileSync(new URL(`./routes/${file}`, import.meta.url), "utf8");
      errors.push(...violations(file, source, exceptions));
    }
    assert.deepEqual(errors, [], `Route permission guard failed:\n${errors.join("\n")}`);
  });

  for (const text of [
    'if (user.role === "admin") {}',
    'if (actor.role !== "contractor") {}',
    'if (req.currentUser?.role === "admin") {}',
    '["admin"].includes(user.role)',
    '["admin"].includes(actor.role)',
    '["admin"].includes(req.currentUser!.role)',
    "isHoaRole(user.role)", "isClientRole(actor.role)",
    "isMapCreatorRole(user.role)", "isContractorSide(user.role)",
    "storage.isUserMemberOfCommunity(id, communityId)",
    "userCanAccessCommunity(user, id)", "storage.canUserAccessTask(id, taskId)",
    'import { canReadTask } from "../policy/tasks";',
    "import { canReadTask } from '../policy/tasks';",
  ]) {
    it(`rejects ${text}`, () => {
      assert.ok(violations("probe.ts", text, []).length > 0);
    });
  }

  it("permits central imports and rejects missing, changed, duplicated or misplaced exceptions", () => {
    assert.deepEqual(violations("probe.ts",
      'import * as policy from "../policy";\nimport { canReadTask } from "../policy";', []), []);
    const entry = exceptions[3];
    assert.deepEqual(violations(entry.file, entry.text, [entry]), []);
    for (const source of ["", `${entry.text} // changed`, `${entry.text}\n${entry.text}`]) {
      assert.ok(violations(entry.file, source, [entry]).some(error => error.includes("allowlist entry")));
    }
    assert.ok(violations("other.ts", entry.text, [entry]).some(error => error.includes("direct role comparison")));
    const extraCheck = `${entry.text}\nif (user.role === "admin") {}`;
    assert.ok(violations(entry.file, extraCheck, [entry]).some(error => error.includes("direct role comparison")));
  });
});
