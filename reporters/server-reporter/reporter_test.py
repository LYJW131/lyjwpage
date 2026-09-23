#!/usr/bin/env python3
"""流量累计那几个纯函数的单测：`python3 reporter_test.py`。

只测 `cycle_bounds` / `accumulate` —— 采集和推送要么读 `/proc`、要么打网络，
它们没有值得钉住的判断；而这两个函数错了是「流量默默多算一倍」这种没人看得出
来的错，正是要钉住的那类。标准库 unittest，和上报器本身一样不装东西。
"""

import os
import sys
import unittest
from datetime import datetime, timezone

os.environ.setdefault("SITE_URL", "https://example.invalid")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from reporter import WINDOW_MS, accumulate, cycle_bounds, record_window, shift_month, summarize_window  # noqa: E402


def at(text: str) -> float:
    return datetime.fromisoformat(text).replace(tzinfo=timezone.utc).timestamp()


def ms(text: str) -> int:
    return int(at(text) * 1000)


class CycleBounds(unittest.TestCase):
    def test_natural_month(self):
        start, end = cycle_bounds(at("2026-09-15T12:00:00"), 1)
        self.assertEqual(start, ms("2026-09-01T00:00:00"))
        self.assertEqual(end, ms("2026-10-01T00:00:00"))

    def test_before_billing_day_belongs_to_previous_cycle(self):
        start, end = cycle_bounds(at("2026-09-03T00:00:00"), 20)
        self.assertEqual(start, ms("2026-08-20T00:00:00"))
        self.assertEqual(end, ms("2026-09-20T00:00:00"))

    def test_billing_day_starts_at_midnight_sharp(self):
        start, _ = cycle_bounds(at("2026-09-20T00:00:00"), 20)
        self.assertEqual(start, ms("2026-09-20T00:00:00"))

    def test_year_rollover(self):
        start, end = cycle_bounds(at("2026-12-31T23:59:59"), 5)
        self.assertEqual(start, ms("2026-12-05T00:00:00"))
        self.assertEqual(end, ms("2027-01-05T00:00:00"))

    def test_shift_month_keeps_day(self):
        moment = datetime(2026, 1, 28, tzinfo=timezone.utc)
        self.assertEqual(shift_month(moment, 1).month, 2)
        self.assertEqual(shift_month(moment, 1).day, 28)
        self.assertEqual(shift_month(moment, -1).year, 2025)


class Accumulate(unittest.TestCase):
    def test_first_round_only_records_the_cursor(self):
        # 开机 200 天的机器第一次跑：计数器里那几个 T 是过去几个月的，不算进这个周期
        state = accumulate({}, "enp3s0", 5_000_000_000_000, 900_000_000_000, at("2026-09-10T00:00:00"), 1)
        self.assertEqual(state["rxBytes"], 0)
        self.assertEqual(state["txBytes"], 0)
        self.assertEqual(state["rxCursor"], 5_000_000_000_000)

    def test_boot_inside_the_cycle_seeds_from_the_counters(self):
        # 周期 9-01 起，机器 9-08 开的：计数器里的字节全是这个周期走的，整份接管
        now = at("2026-09-15T00:00:00")
        state = accumulate({}, "enp3s0", 700_000, 400_000, now, 1, ms("2026-09-08T00:00:00"))
        self.assertEqual(state["rxBytes"], 700_000)
        self.assertEqual(state["txBytes"], 400_000)

    def test_boot_before_the_cycle_starts_from_zero(self):
        now = at("2026-09-15T00:00:00")
        state = accumulate({}, "enp3s0", 5_000_000, 4_000_000, now, 1, ms("2026-08-20T00:00:00"))
        self.assertEqual(state["rxBytes"], 0)
        self.assertEqual(state["txBytes"], 0)

    def test_interface_change_never_seeds_from_boot(self):
        # 旧卡那段已经数过了，再按开机时刻接管一次就是重复计数
        now = at("2026-09-15T00:00:00")
        old = accumulate({}, "enp3s0", 1_000, 1_000, now, 1)
        old = accumulate(old, "enp3s0", 3_000, 3_000, now + 60, 1)
        moved = accumulate(old, "eth0", 90_000, 80_000, now + 120, 1, ms("2026-09-08T00:00:00"))
        self.assertEqual(moved["rxBytes"], 0)

    def test_second_round_adds_the_delta(self):
        now = at("2026-09-10T00:00:00")
        first = accumulate({}, "enp3s0", 1_000, 500, now, 1)
        second = accumulate(first, "enp3s0", 1_800, 900, now + 60, 1)
        self.assertEqual(second["rxBytes"], 800)
        self.assertEqual(second["txBytes"], 400)
        third = accumulate(second, "enp3s0", 2_000, 1_000, now + 120, 1)
        self.assertEqual(third["rxBytes"], 1_000)
        self.assertEqual(third["txBytes"], 500)

    def test_counter_reset_counts_the_new_reading_itself(self):
        # 机器重启：网卡从 0 重新数，开机到这一轮之间那段就是当前读数
        now = at("2026-09-10T00:00:00")
        before = accumulate({}, "enp3s0", 9_000, 9_000, now, 1)
        before = accumulate(before, "enp3s0", 10_000, 10_000, now + 60, 1)
        self.assertEqual(before["rxBytes"], 1_000)
        after = accumulate(before, "enp3s0", 300, 200, now + 120, 1)
        self.assertEqual(after["rxBytes"], 1_300)
        self.assertEqual(after["txBytes"], 1_200)

    def test_new_cycle_starts_from_zero(self):
        last = accumulate({}, "enp3s0", 1_000, 1_000, at("2026-09-30T23:59:00"), 1)
        last = accumulate(last, "enp3s0", 2_000, 2_000, at("2026-09-30T23:59:30"), 1)
        self.assertEqual(last["rxBytes"], 1_000)
        rolled = accumulate(last, "enp3s0", 2_500, 2_400, at("2026-10-01T00:00:30"), 1)
        self.assertEqual(rolled["cycleStart"], ms("2026-10-01T00:00:00"))
        # 跨边界那一轮整段算进新周期，不按秒劈开
        self.assertEqual(rolled["rxBytes"], 500)
        self.assertEqual(rolled["txBytes"], 400)

    def test_interface_change_drops_the_cursor(self):
        now = at("2026-09-10T00:00:00")
        old = accumulate({}, "enp3s0", 1_000, 1_000, now, 1)
        old = accumulate(old, "enp3s0", 3_000, 3_000, now + 60, 1)
        self.assertEqual(old["rxBytes"], 2_000)
        moved = accumulate(old, "eth0", 80_000, 70_000, now + 120, 1)
        self.assertEqual(moved["interface"], "eth0")
        self.assertEqual(moved["rxBytes"], 0)
        self.assertEqual(moved["txBytes"], 0)

    def test_state_is_json_shaped(self):
        state = accumulate({}, "enp3s0", 1, 2, at("2026-09-10T00:00:00"), 1)
        self.assertEqual(state["version"], 1)
        self.assertEqual(state["cycleEnd"], ms("2026-10-01T00:00:00"))
        self.assertEqual(sorted(state), [
            "cycleEnd", "cycleStart", "interface", "rxBytes", "rxCursor",
            "txBytes", "txCursor", "updatedAt", "version",
        ])



class Window(unittest.TestCase):
    def test_cpu_average_is_weighted_by_duration(self):
        now = 1_790_200_000_000
        samples = record_window([], now - 900_000, 900_000, 10.0)  # 15 分钟 10%
        samples = record_window(samples, now, 60_000, 70.0)  # 1 分钟 70%
        summary = summarize_window(samples, now)
        self.assertAlmostEqual(summary["cpuAvgPercent"], round((10 * 900 + 70 * 60) / 960, 1))
        self.assertEqual(summary["reports"], 2)
        self.assertEqual(summary["start"], now - 900_000 - 900_000)
        self.assertEqual(summary["end"], now)

    def test_old_samples_fall_out(self):
        now = 1_790_200_000_000
        samples = record_window([], now - WINDOW_MS - 60_000, 60_000, 5.0)
        samples = record_window(samples, now - 120_000, 60_000, 5.0)
        samples = record_window(samples, now, 60_000, 5.0)
        self.assertEqual(len(samples), 2)
        summary = summarize_window(samples, now)
        self.assertEqual(summary["reports"], 2)
        # 窗口起点不早于 12 小时前
        self.assertGreaterEqual(summary["start"], now - WINDOW_MS)
        self.assertIsNone(summarize_window([], now))

    def test_samples_from_an_older_shape_are_dropped(self):
        now = 1_790_200_000_000
        samples = record_window([[now - 60_000, 60_000, 5.0, 10, 10]], now, 60_000, 5.0)
        self.assertEqual(samples, [[now, 60_000, 5.0]])


if __name__ == "__main__":
    unittest.main()
