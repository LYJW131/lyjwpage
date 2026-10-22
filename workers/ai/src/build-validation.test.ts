import assert from "node:assert/strict";
import test from "node:test";
import { BUILD_PLAN_LIMITS, BUILD_UPLOAD_LIMITS, type BuildPlan, type BuildUpload } from "@shared/build-routine";
import { PROJECT_DOCS } from "./tools/project-docs.ts";
import { allowedBuildPath, checkBuildPlan, markdownDoc, outsidePlanPaths, parseBuildPlan, parseBuildUpload } from "./build/validation.ts";

const plan: BuildPlan = { title: "Improve the card", spec: "Show card details.", acceptance: ["Details fit on mobile."], paths: ["src/components/card.tsx"] };
const upload: BuildUpload = {
  baseSha: "a".repeat(40), message: "feat: improve the card",
  files: [{ path: plan.paths[0], mode: "100644", content: btoa("export default true;") }], deletions: [],
};

for (const path of [
  "src/claude.md", "src/lib/Agents.md", "docs/AGENTS.override.md", "docs/CLAUDE.local.md", "src/GEMINI.md",
  "src/.cursor/rules/x.mdc", "src/.Claude/settings.json", "src/.vscode/tasks.json", ".Claude/x.test.js", ".GitHub/x.test.js", "foo.test.mjs",
  "src/.CURSORRULES", "shared/.Codex/config.json", "docs/.AGENTS/rules.md", "public/.Gemini/settings.json",
  "workers/ai/src/.Windsurf/rules/x.md", "src/.windsurfrules", "src/.windsurf-config/rule.md", "docs/.devContainer/config.json",
  "src/.Husky/pre-commit", "src/.Idea/tasks.xml", "src/Scripts/check.test.ts", "src/Package.JSON", "src/.Git/config",
  "src/.GiThUb/workflows/ci.yml", "src/NEXT.CONFIG.ts", "workers/ai/src/WRANGLER.TEST.TOML",
  "tests/route.test.ts", "workers/ai/tests/route.test.ts", "workers/ai/foo.spec.ts", "reporters/agent.test.ts",
]) {
  test(`protected path cannot enter plans, uploads, or deletions: ${path}`, () => {
    assert.equal(allowedBuildPath(path), false);
    assert.equal(parseBuildPlan({ ...plan, paths: [path] }), null);
    assert.throws(() => parseBuildUpload({ ...upload, files: [{ ...upload.files[0], path }] }, [path]), /outside the allowed scope/);
    assert.throws(() => parseBuildUpload({ ...upload, files: [], deletions: [path] }, [path]), /outside the allowed scope/);
  });
}

test("source, asset, documentation, shared, and worker roots still admit ordinary files and colocated tests", () => {
  for (const path of ["src/app/[slug]/page.tsx", "public/card.png", "docs/card.md", "shared/card.ts", "workers/ai/src/card.ts", "src/card.test.mts", "workers/core/src/card.spec.ts"]) {
    assert.equal(allowedBuildPath(path), true, path);
    assert.equal(parseBuildUpload({ ...upload, files: [{ ...upload.files[0], path }] }, [path]).files[0].path, path);
  }
});

test("plan prose rejects protected instruction paths without depending on case", () => {
  for (const path of ["claude.md", "AGENTS.override.md", "CLAUDE.local.md", "GEMINI.md", "src/.Cursor/rules/x.mdc", "src/.Claude/settings.json", "docs/.Windsurf/rules.md"]) {
    assert.equal(parseBuildPlan({ ...plan, spec: `Update ${path}` }), null, path);
  }
});

test("upload permits approved files, deletions, and test files in the same directory", () => {
  for (const path of [plan.paths[0], "src/components/card.test.tsx", "src/components/layout.spec.mjs", "src/components/card.test.cts"]) {
    assert.equal(parseBuildUpload({ ...upload, files: [{ ...upload.files[0], path }] }, plan.paths).files[0].path, path);
    assert.deepEqual(parseBuildUpload({ ...upload, files: [], deletions: [path] }, plan.paths).deletions, [path]);
  }
});

test("upload allows a few files outside the plan, counts them, and rejects more", () => {
  const outside = ["src/components/other.tsx", "src/card.tsx", "src/card.test.tsx", "src/components/nested/card.test.tsx", "src/components/card.tsx/child.ts", "src/components/card.test.tsx.json", "docs/card.md"];
  for (const path of outside) {
    const parsed = parseBuildUpload({ ...upload, files: [{ ...upload.files[0], path }] }, plan.paths);
    assert.deepEqual(outsidePlanPaths(parsed, plan.paths), [path]);
  }
  const docs = ["workers/ai/NOTES.md", "README.md", "apps/ios/NOTES.md", "docs/a.md", "src/x.md", "workers/core/NOTES.md"];
  assert.equal(parseBuildUpload({ ...upload, files: docs.map((path) => ({ ...upload.files[0], path })) }, plan.paths).files.length, docs.length);
  for (const path of ["AGENTS.md", "workers/ai/AGENTS.md", "CLAUDE.md", ".github/README.md", "reporters/server-reporter/README.md"]) assert.equal(allowedBuildPath(path), false, path);
  const allowed = outside.slice(0, BUILD_UPLOAD_LIMITS.outsidePlanFiles);
  assert.equal(parseBuildUpload({ ...upload, files: [], deletions: allowed }, plan.paths).deletions.length, allowed.length);
  assert.throws(() => parseBuildUpload({ ...upload, files: [], deletions: outside.slice(0, BUILD_UPLOAD_LIMITS.outsidePlanFiles + 1) }, plan.paths), /outside the approved plan paths \(at most/);
  assert.deepEqual(outsidePlanPaths(parseBuildUpload(upload, plan.paths), plan.paths), []);
});

test("approved directory plans permit descendants and keep sibling prefixes outside the scope", () => {
  const directoryPlan = parseBuildPlan({ ...plan, paths: ["src/components/", "workers/ai/src/tools/"] });
  assert.ok(directoryPlan);
  for (const path of ["src/components/card.tsx", "src/components/nested/card.tsx", "workers/ai/src/tools/lookup.ts"]) {
    assert.equal(parseBuildUpload({ ...upload, files: [{ ...upload.files[0], path }] }, directoryPlan.paths).files[0].path, path);
  }
  for (const path of ["src/components-extra/card.tsx", "src/components.test.ts", "src/other/card.test.ts", "workers/ai/src/tools-extra/lookup.ts"]) {
    assert.deepEqual(outsidePlanPaths({ files: [{ ...upload.files[0], path }], deletions: [] }, directoryPlan.paths), [path]);
  }
  const broadPlan = parseBuildPlan({ ...plan, paths: ["src/"] });
  assert.ok(broadPlan);
  assert.equal(parseBuildUpload(upload, broadPlan.paths).files[0].path, plan.paths[0]);
});

test("plan rejections name the exact problem so the planner can fix it", () => {
  const reason = (value: unknown) => { const checked = checkBuildPlan(value); return "error" in checked ? checked.error : null; };
  assert.match(reason({ ...plan, spec: "x".repeat(BUILD_PLAN_LIMITS.specChars + 1) }) ?? "", /spec must be 1 to \d+ characters; it has \d+/);
  assert.match(reason({ ...plan, spec: "Follow the rules in workers/ai/AGENTS.md." }) ?? "", /names "workers\/ai\/AGENTS\.md\.?", a protected file/);
  assert.match(reason({ ...plan, paths: ["package.json"] }) ?? "", /Path "package\.json" is not allowed/);
  assert.match(reason({ ...plan, acceptance: [] }) ?? "", /Give 1 to \d+ acceptance checks; there are 0/);
  assert.equal(reason(plan), null);
});

const directiveDocs = [
  "HUMAN.md", "REVIEW.md", "DESIGN.md", "GLOSSARY.md", "docs/ops-facts.md", "docs/api-contracts.md",
  "human.md", "docs/Ops-Facts.md", "docs/explainer/DESIGN.md", "src/Glossary.md",
];

for (const path of directiveDocs) {
  test(`agent-directive markdown cannot be planned, uploaded, deleted, or counted as plain documentation: ${path}`, () => {
    assert.equal(allowedBuildPath(path), false);
    assert.equal(markdownDoc(path), false);
    assert.equal(parseBuildPlan({ ...plan, paths: [path] }), null);
    if (path.includes("/")) assert.equal(parseBuildPlan({ ...plan, spec: `Update ${path} to match.` }), null);
    assert.throws(() => parseBuildUpload({ ...upload, files: [{ ...upload.files[0], path }] }, plan.paths), /outside the allowed scope/);
    assert.throws(() => parseBuildUpload({ ...upload, files: [], deletions: [path] }, plan.paths), /outside the allowed scope/);
  });
}

test("every repository document served to models by read_project_doc is protected, reporters and other repositories excluded", () => {
  const served = Object.values(PROJECT_DOCS).filter((doc) => !("repo" in doc)).map((doc) => doc.path);
  assert.ok(served.includes("workers/ai/README.md"));
  for (const path of served) {
    assert.equal(allowedBuildPath(path), false, path);
    assert.throws(() => parseBuildUpload({ ...upload, files: [], deletions: [path] }, plan.paths), /outside the allowed scope/, path);
    assert.equal(parseBuildPlan({ ...plan, paths: [path] }), null, path);
  }
  assert.equal(allowedBuildPath("README.md"), true);
});

test("plan prose naming a served document by path is rejected; a bare style-guide name is not", () => {
  for (const spec of ["See docs/ops-facts.md, then edit.", "Quote workers/core/README.md."]) {
    assert.equal(parseBuildPlan({ ...plan, spec }), null, spec);
  }
  for (const spec of ["Follow DESIGN.md for spacing.", "Document the card in docs/card.md and redesign.md notes."]) {
    assert.ok(parseBuildPlan({ ...plan, spec }), spec);
  }
});

for (const path of [
  "docs/explainer/render/serve.mjs", "docs/x.js", "docs/x.cjs", "docs/x.ts", "docs/x.mts", "docs/x.tsx", "docs/x.sh", "docs/x.py", "docs/X.PY",
  "docs/explainer/render/package.json", "docs/package-lock.json", "docs/yarn.lock", "docs/pnpm-lock.yaml",
  "docs/explainer/render/node_modules/playwright-core/index.mjs",
]) {
  test(`docs/ accepts only non-executable content: ${path}`, () => {
    assert.equal(allowedBuildPath(path), false);
    assert.equal(parseBuildPlan({ ...plan, paths: [path] }), null);
    assert.throws(() => parseBuildUpload({ ...upload, files: [{ ...upload.files[0], path }] }, [path]), /outside the allowed scope/);
    assert.throws(() => parseBuildUpload({ ...upload, files: [], deletions: [path] }, [path]), /outside the allowed scope/);
  });
}

for (const path of ["public/sw.js", "public/app/x.js", "public/x.mjs", "public/_headers", "public/sub/_headers", "public/_redirects", "public/offline.html", "public/a/b.htm", "public/badge.svg", "public/a.xhtml", "public/a.xht", "public/feed.xml"]) {
  test(`public/ rejects executable and header files: ${path}`, () => {
    assert.equal(allowedBuildPath(path), false);
    assert.equal(parseBuildPlan({ ...plan, paths: [path] }), null);
    assert.throws(() => parseBuildUpload({ ...upload, files: [], deletions: [path] }, ["public/"]), /outside the allowed scope/);
  });
}

test("docs/ and public/ still admit markdown and images, and script suffixes stay fine under src/", () => {
  for (const path of ["docs/card.md", "docs/img/card.png", "docs/img/card.svg", "public/card.png", "public/img/card.webp", "src/x.sh.md", "src/lib/x.mjs", "workers/ai/src/x.js"]) {
    assert.equal(allowedBuildPath(path), true, path);
  }
  assert.equal(parseBuildUpload({ ...upload, files: [], deletions: ["docs/card.md"] }, ["docs/"]).deletions[0], "docs/card.md");
  assert.ok(parseBuildPlan({ ...plan, paths: ["docs/", "public/"] }));
});
