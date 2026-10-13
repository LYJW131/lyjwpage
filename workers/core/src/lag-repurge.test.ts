import assert from "node:assert/strict";
import test from "node:test";

import { STATUS_VIEWS } from "@shared/status-views";

import { lagStatusTags, queueRepurge, takeDueRepurge } from "./lag-repurge";

test("只有可滞后层视图的标签需要补一次失效，实时层的数据源是强一致的", () => {
  assert.deepEqual(
    lagStatusTags([STATUS_VIEWS.agentStatus.tag, STATUS_VIEWS.charger.tag, STATUS_VIEWS.server.tag, "home", STATUS_VIEWS.server.tag]),
    [STATUS_VIEWS.agentStatus.tag, STATUS_VIEWS.server.tag],
  );
});

test("同一标签再次写入时，补失效按最后一次写入往后排", () => {
  const first = queueRepurge({}, ["server"], 1_000);
  assert.deepEqual(queueRepurge(first, ["server", "limits"], 5_000), { server: 5_000, limits: 5_000 });
  assert.deepEqual(queueRepurge({ server: 9_000 }, ["server"], 5_000), { server: 9_000 });
});

test("到期的标签取出，没到期的留着并给出下一次时间", () => {
  assert.deepEqual(takeDueRepurge({ server: 1_000, limits: 3_000, "agent-status": 2_000 }, 2_000), {
    due: ["server", "agent-status"],
    rest: { limits: 3_000 },
    next: 3_000,
  });
  assert.deepEqual(takeDueRepurge({ server: 1_000 }, 1_000), { due: ["server"], rest: {}, next: null });
  assert.deepEqual(takeDueRepurge({}, 1_000), { due: [], rest: {}, next: null });
});
