import json
import os
import tempfile
import unittest

import check

HERE = os.path.dirname(os.path.abspath(__file__))
HOUR = check.HOUR
NOW = 1_800_000_000_000


def load_vectors():
    with open(os.path.join(HERE, "signature-vectors.json"), encoding="utf-8") as f:
        return json.load(f)


def runs(n, **fields):
    return [{"hash": "same", "updatedAt": NOW - (n - i) * 6 * HOUR, "at": NOW - (n - i) * 6 * HOUR, **fields} for i in range(n)]


class SignatureTest(unittest.TestCase):
    def test_vectors_shared_with_errors_query(self):
        for v in load_vectors():
            with self.subTest(v["name"]):
                text = check.signature(v["service"], v["message"], v.get("status"))
                self.assertEqual(text, v["signature"])
                self.assertEqual(check.signature_hash(text), v["hash"])

    def test_boolean_status_is_not_a_status_code(self):
        self.assertEqual(check.signature("site", "x", True), "site: x")


class QueryTest(unittest.TestCase):
    def test_render_fills_the_window_line(self):
        with open(check.QUERY_FILE, encoding="utf-8") as f:
            rendered = check.render_query(f.read(), 100, 200)
        self.assertIn("const WINDOW = { from: 100, to: 200 };", rendered)
        self.assertTrue(rendered.lstrip().startswith("async () =>"))

    def test_render_refuses_a_template_without_the_window_line(self):
        with self.assertRaises(ValueError):
            check.render_query("async () => ({})", 1, 2)

    def test_window_starts_at_last_run_or_a_day_back(self):
        self.assertEqual(check.query_window({"lastRunAt": 123}, NOW), (123, NOW))
        self.assertEqual(check.query_window({}, NOW), (NOW - check.FIRST_WINDOW_MS, NOW))


class StateTest(unittest.TestCase):
    def test_missing_state_is_empty(self):
        with tempfile.TemporaryDirectory() as d:
            state = check.load_state(os.path.join(d, "state.json"))
        self.assertEqual(state, {"lastRunAt": None, "snapshots": {}, "ledger": []})

    def test_broken_state_stops_instead_of_starting_over(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "state.json")
            with open(path, "w", encoding="utf-8") as f:
                f.write("{")
            with self.assertRaises(check.StateError):
                check.load_state(path)


class FrozenTest(unittest.TestCase):
    def test_twelve_identical_hashes_with_moving_updated_at(self):
        history = {"digest": runs(11)}
        current = {"digest": {"hash": "same", "updatedAt": NOW, "at": NOW}}
        found = check.frozen_findings(history, current, None, NOW)
        self.assertEqual([(f["view"], f["kind"], f["part"]) for f in found], [("digest", "frozen", None)])
        self.assertEqual(found[0]["since"], history["digest"][0]["at"])

    def test_fewer_than_twelve_is_not_enough(self):
        found = check.frozen_findings({"digest": runs(10)}, {"digest": {"hash": "same", "updatedAt": NOW}}, None, NOW)
        self.assertEqual(found, [])

    def test_one_change_breaks_the_streak(self):
        history = {"digest": runs(15)}
        history["digest"][4]["hash"] = "older"
        self.assertEqual(check.frozen_findings(history, {"digest": {"hash": "same", "updatedAt": NOW}}, None, NOW), [])

    def test_updated_at_not_moving_is_left_to_the_stale_check(self):
        history = {"digest": [dict(s, updatedAt=1) for s in runs(11)]}
        self.assertEqual(check.frozen_findings(history, {"digest": {"hash": "same", "updatedAt": 1}}, None, NOW), [])

    def test_composite_views_are_judged_per_part(self):
        parts = {"site.metrics": "m", "core.metrics": "c", "core.deployment": "d"}
        history = {"cloudflare-workers": runs(11, parts=dict(parts))}
        history["cloudflare-workers"][5]["parts"]["core.metrics"] = "changed"
        current = {"cloudflare-workers": {"hash": "new", "updatedAt": NOW, "parts": dict(parts)}}
        found = check.frozen_findings(history, current, None, NOW)
        self.assertEqual([f["part"] for f in found], ["site.metrics"])

    def test_deploy_parts_need_main_to_have_moved(self):
        parts = {"production": "p", "analytics": "a"}
        history = {"site-deployments": runs(11, parts=dict(parts))}
        history["site-deployments"][3]["parts"]["analytics"] = "x"
        current = {"site-deployments": {"hash": "h", "updatedAt": NOW, "parts": dict(parts)}}
        since = history["site-deployments"][0]["at"]
        self.assertEqual(check.frozen_findings(history, current, since - HOUR, NOW), [])
        self.assertEqual(check.frozen_findings(history, current, NOW - HOUR, NOW), [])
        found = check.frozen_findings(history, current, since + HOUR, NOW)
        self.assertEqual([f["part"] for f in found], ["production"])
        self.assertIn("main 有新提交", found[0]["msg"])


class DropTest(unittest.TestCase):
    def test_more_than_half_below_the_recent_median(self):
        history = {"site-deployments": [{"pageviews": 1800}, {"pageviews": 90}, {"pageviews": 1700}, {"pageviews": 1900}]}
        found = check.drop_findings(history, {"site-deployments": {"pageviews": 800}})
        self.assertEqual([(f["metric"], f["kind"]) for f in found], [("pageviews", "drop")])
        self.assertIn("从 1700 掉到 800", found[0]["msg"])

    def test_exactly_half_is_not_a_drop(self):
        history = {"agent-status": [{"agents": 8}, {"agents": 8}, {"agents": 8}]}
        self.assertEqual(check.drop_findings(history, {"agent-status": {"agents": 4}}), [])

    def test_worker_count_and_pagespeed(self):
        history = {
            "cloudflare-workers": [{"workers": ["a", "b", "c", "d"]}] * 3,
            "site-deployments": [{"pagespeed": {"desktop": 94, "mobile": 89}}] * 3,
        }
        current = {
            "cloudflare-workers": {"workers": ["a"]},
            "site-deployments": {"pagespeed": {"desktop": 93, "mobile": 40}},
        }
        found = check.drop_findings(history, current)
        self.assertEqual(sorted(f["metric"] for f in found), ["pagespeed.mobile", "workers"])

    def test_missing_values_are_skipped(self):
        history = {"site-deployments": [{"pagespeed": {"mobile": None}}, {}]}
        self.assertEqual(check.drop_findings(history, {"site-deployments": {"pagespeed": {"mobile": 10}}}), [])
        self.assertEqual(check.drop_findings({"site-deployments": [{"pageviews": 10}]}, {"site-deployments": {}}), [])


class SnapshotsTest(unittest.TestCase):
    def test_keeps_twelve_drops_retired_views_and_keeps_unread_ones(self):
        history = {"digest": runs(12), "health": runs(3), "sentry": runs(2)}
        current = {"digest": {"hash": "new", "updatedAt": NOW}}
        out = check.next_snapshots(history, current)
        self.assertEqual(len(out["digest"]), check.FROZEN_RUNS)
        self.assertEqual(out["digest"][-1]["hash"], "new")
        self.assertEqual(out["health"], history["health"])
        self.assertNotIn("sentry", out)


def sig(text, count=1, **extra):
    service = text.split(":", 1)[0]
    return {"signature": check.signature_hash(text), "text": text, "service": service, "count": count, "firstSeen": 1, "lastSeen": 2, **extra}


class TriageTest(unittest.TestCase):
    def test_three_piles(self):
        muted, known, fresh, back = (
            sig("site: GET https://lyjw.me/image?<q> 502", 87),
            sig("core: Network connection lost.", 12),
            sig("core: Feed stale"),
            sig("site: e.toSorted is not a function"),
        )
        ledger = [
            {"id": "image-expired", "status": "muted", "signature": [muted["signature"]]},
            {"id": "core-lost", "status": "open", "repro": "none", "signature": known["signature"]},
            {"id": "tosorted", "status": "resolved", "signature": [back["signature"]]},
            {"id": "scanner", "view": "site", "status": "muted", "signatures": ["site: Can't read from request stream"], "msg": "扫描器"},
            {"id": "old-fix", "status": "fixed", "msg": "已修"},
            {"id": "agent-frozen", "view": "agent-status", "kind": "frozen", "status": "muted"},
        ]
        out = check.triage({"window": {"from": 1, "to": 2}, "signatures": [muted, known, fresh, back]}, ledger)
        self.assertEqual([s["ledger"] for s in out["muted"]], ["image-expired"])
        self.assertEqual([(s["ledger"], s["repro"]) for s in out["known"]], [("core-lost", "none")])
        self.assertEqual([s["text"] for s in out["new"]], ["core: Feed stale", "site: e.toSorted is not a function"])
        self.assertEqual(out["new"][1]["reopens"], ["tosorted"])
        self.assertEqual([e["id"] for e in out["unlinked"]], ["scanner"])
        self.assertEqual(out["drift"], [])
        self.assertEqual(out["window"], {"from": 1, "to": 2})

    def test_ledger_text_identical_to_a_signature_is_backfilled(self):
        lost, fixed = sig("core: Network connection lost."), sig("site: e.toSorted is not a function")
        ledger = [
            {"id": "core-lost", "status": "open", "signatures": ["core: Network connection lost."]},
            {"id": "tosorted", "status": "resolved", "signatures": ["site: e.toSorted is not a function"]},
            {"id": "image", "status": "muted", "signatures": ["site: GET /image?url=<blobstore.apple.com> 502"]},
        ]
        out = check.triage({"signatures": [lost, fixed]}, ledger)
        self.assertEqual(out["backfill"], [{"ledger": "core-lost", "signature": lost["signature"]}, {"ledger": "tosorted", "signature": fixed["signature"]}])
        self.assertEqual([s["ledger"] for s in out["known"]], ["core-lost"])
        self.assertEqual(out["new"][0]["reopens"], ["tosorted"])
        self.assertEqual([e["id"] for e in out["unlinked"]], ["image"])

    def test_drift_between_the_two_normalizers_is_reported(self):
        good = sig("core: request <id> failed", sample={"message": "request 93da7ae4876b6b9aa71d98b036e6fc21 failed", "status": None})
        renamed = sig("core: request 93da7ae4876b6b9aa71d98b036e6fc21 failed", sample={"message": "request 93da7ae4876b6b9aa71d98b036e6fc21 failed", "status": None})
        bad_hash = dict(sig("core: x"), signature="000000000000")
        out = check.triage({"signatures": [good, renamed, bad_hash]}, [])
        self.assertEqual([d["text"] for d in out["drift"]], [renamed["text"], "core: x"])


if __name__ == "__main__":
    unittest.main()
