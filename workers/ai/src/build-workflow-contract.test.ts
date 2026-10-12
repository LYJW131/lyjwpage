import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { BUILD_REPO } from "@shared/build-routine";
import { BUILD_WORKFLOW_REF } from "./build/actions-oidc.ts";

const here = dirname(fileURLToPath(import.meta.url));
const workflowPath = BUILD_WORKFLOW_REF.match(new RegExp(`^${BUILD_REPO}/(.+)@refs/heads/main$`))?.[1];
const workflow = readFileSync(join(here, "../../..", workflowPath ?? "missing"), "utf8");
const handlers = readFileSync(join(here, "build/handlers.ts"), "utf8");

function dispatched() {
  const call = handlers.match(/"\/dispatches", "POST", \{ event_type: "([^"]+)", client_payload: \{([^}]*)\} \}/);
  assert.ok(call, "dispatchBuild must send a literal event_type and client_payload");
  return { eventType: call[1], keys: call[2].split(",").map((entry) => entry.split(":")[0].trim()).sort() };
}

test("OIDC workflow_ref names the build workflow file on main, triggered by repository_dispatch", () => {
  assert.ok(workflowPath, "BUILD_WORKFLOW_REF must name a workflow in BUILD_REPO on refs/heads/main");
  const trigger = workflow.match(/^on:\n {2}repository_dispatch:\n {4}types: \[([a-z-]+)\]\n\n?\S/m);
  assert.equal(trigger?.[1], dispatched().eventType);
});

test("the workflow reads exactly the client_payload keys the Worker dispatches", () => {
  const read = [...new Set([...workflow.matchAll(/github\.event\.client_payload\.([A-Za-z]+)/g)].map((match) => match[1]))].sort();
  assert.deepEqual(read, dispatched().keys);
});
