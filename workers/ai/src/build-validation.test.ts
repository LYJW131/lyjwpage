import assert from "node:assert/strict";
import test from "node:test";
import { type BuildPlan, type BuildUpload } from "@shared/build-routine";
import { allowedBuildPath, parseBuildPlan, parseBuildUpload } from "./build/validation.ts";

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
  for (const path of ["src/app/[slug]/page.tsx", "public/card.svg", "docs/card.md", "shared/card.ts", "workers/ai/src/card.ts", "src/card.test.mts", "workers/api/src/card.spec.ts"]) {
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

test("upload rejects unrelated files and tests outside the approved file directory", () => {
  for (const path of ["src/components/other.tsx", "src/card.tsx", "src/card.test.tsx", "src/components/nested/card.test.tsx", "src/components/card.tsx/child.ts", "src/components/card.test.tsx.json", "docs/card.md"]) {
    for (const change of [{ files: [{ ...upload.files[0], path }], deletions: [] }, { files: [], deletions: [path] }]) {
      assert.throws(() => parseBuildUpload({ ...upload, ...change }, plan.paths), (error) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, `Changed path "${path}" is outside the approved plan paths.`);
        return true;
      });
    }
  }
  assert.throws(() => parseBuildUpload(upload, []), /outside the approved plan paths/);
});

test("approved directory plans permit descendants and keep sibling prefixes outside the scope", () => {
  const directoryPlan = parseBuildPlan({ ...plan, paths: ["src/components/", "workers/ai/src/tools/"] });
  assert.ok(directoryPlan);
  for (const path of ["src/components/card.tsx", "src/components/nested/card.tsx", "workers/ai/src/tools/lookup.ts"]) {
    assert.equal(parseBuildUpload({ ...upload, files: [{ ...upload.files[0], path }] }, directoryPlan.paths).files[0].path, path);
  }
  for (const path of ["src/components-extra/card.tsx", "src/components.test.ts", "src/other/card.test.ts", "workers/ai/src/tools-extra/lookup.ts"]) {
    assert.throws(() => parseBuildUpload({ ...upload, files: [{ ...upload.files[0], path }] }, directoryPlan.paths), /outside the approved plan paths/);
  }
  const broadPlan = parseBuildPlan({ ...plan, paths: ["src/"] });
  assert.ok(broadPlan);
  assert.equal(parseBuildUpload(upload, broadPlan.paths).files[0].path, plan.paths[0]);
});
