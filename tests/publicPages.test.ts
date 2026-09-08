import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("public home represents the application without redirecting to the dashboard", () => {
  const page = read("app/page.tsx");

  assert.doesNotMatch(page, /redirect\(/);
  assert.match(page, /TheCozyCedar Social Automation/);
  assert.match(page, /href="\/privacy"/);
  assert.match(page, /href="\/data-deletion"/);
  assert.ok(existsSync(join(root, "public/images/social-publishing-dashboard.png")));
});

test("privacy policy documents connected services and AI processing", () => {
  const page = read("app/privacy/page.tsx");

  for (const service of ["Etsy", "Pinterest", "Instagram", "OpenAI", "Supabase", "Vercel"]) {
    assert.match(page, new RegExp(service));
  }
  assert.match(page, /OAuth tokens/);
  assert.match(page, /Data Deletion Instructions/);
  assert.match(page, /cfapparel2025@gmail\.com/);
});

test("data deletion instructions are public and actionable", () => {
  const page = read("app/data-deletion/page.tsx");

  assert.match(page, /Data Deletion Request/);
  assert.match(page, /within 30 days/);
  assert.match(page, /OAuth tokens/);
  assert.match(page, /cfapparel2025@gmail\.com/);
});
