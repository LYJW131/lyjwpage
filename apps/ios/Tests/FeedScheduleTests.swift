import Foundation
import Testing
#if canImport(LyjwpageCore)
@testable import LyjwpageCore
#endif

/// 排期对着站点的 `src/lib/poll-schedule.ts`：App 打在 Worker 上的量不该比一个浏览器标签页多
@Suite struct FeedScheduleTests {
    private let now = Date(epochMilliseconds: 10_000_000)

    @Test func lagViewWaitsForNextExpectedWrite() {
        // 写入方 20 秒前写过、节奏 60 秒：再等 40 秒 + 15 秒宽限
        let delay = FeedSchedule.lagDelay(updatedAt: now.epochMilliseconds - 20_000, cadence: 60, now: now)
        #expect(delay == 55)
    }

    @Test func overdueLagViewBacksOffWithinCap() {
        // 按小时报的圆环一夜没报：封顶 5 分钟一取，不狂刷
        let overnight = FeedSchedule.lagDelay(updatedAt: now.epochMilliseconds - 10 * 3_600_000, cadence: 3600, now: now)
        #expect(overnight == 300)
        // 刚逾期：从 15 秒起步
        let justLate = FeedSchedule.lagDelay(updatedAt: now.epochMilliseconds - 76_000, cadence: 60, now: now)
        #expect(justLate == 15)
    }

    @Test func pushCoveredViewsFallBackToSafetyNetWhileLive() {
        let live = FeedSchedule.nextDue(for: .nowWatching, updatedAt: nil, socketLive: true, now: now)
        let offline = FeedSchedule.nextDue(for: .nowWatching, updatedAt: nil, socketLive: false, now: now)
        #expect(live.timeIntervalSince(now) == 300)
        #expect(offline.timeIntervalSince(now) == 60)
        // 靠心跳判活的不退：推送连着也照常轮询
        let charger = FeedSchedule.nextDue(for: .charger, updatedAt: nil, socketLive: true, now: now)
        #expect(charger.timeIntervalSince(now) == 30)
    }

    @Test func everyFeedHasAPath() {
        for key in FeedKey.allCases {
            #expect(key.path.hasPrefix("/api/"), "\(key) 的路径不对：\(key.path)")
        }
    }
}

/// 派生判断对着站点首页的规则
@MainActor
@Suite struct DerivedStateTests {
    private func watching(paused: Bool) throws -> NowWatchingPayload {
        let json = """
        {"nowPlaying":{"itemId":"1","paused":\(paused),"progress":50,"client":null,"deviceName":null,"playMethod":null,"media":null,"positionMs":600000,"durationMs":1200000},"current":null}
        """
        return try StatusClient.decoder.decode(NowWatchingPayload.self, from: Data(json.utf8))
    }

    @Test func watchingProgressAdvancesWhilePlaying() throws {
        let store = LiveStore()
        store.nowWatching = try watching(paused: false)
        store.nowWatchingAt = 1_000_000
        // 12 万毫秒是 2 分钟，占 20 分钟片长的 10%
        #expect(store.nowWatchingProgress(now: Date(epochMilliseconds: 1_120_000)) == 60)
        #expect(store.nowWatchingProgress(now: Date(epochMilliseconds: 99_000_000)) == 100)
    }

    @Test func pausedWatchingProgressStaysPut() throws {
        let store = LiveStore()
        store.nowWatching = try watching(paused: true)
        store.nowWatchingAt = 1_000_000
        #expect(store.nowWatchingProgress(now: Date(epochMilliseconds: 1_120_000)) == 50)
    }
}
