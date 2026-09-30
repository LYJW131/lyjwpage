import SwiftUI

/**
 Vibe Coding 卡：今天的 token、此刻在用的 agent、累计用量。点进去是年度热力图和账号限额。

 「今天」按站点时区的日历算，某个 agent 最近一天不是今天就不计进今天 —— 不把昨天的数当今天的。
 某一路来源采集失败时标 Partial，不把缺的那部分当成 0。
 */
struct CodingCard: View {
    @Environment(LiveStore.self) private var store
    let now: Date

    var body: some View {
        let active = store.activeCodingAgents(now: now)
        NavigationLink(value: NowRoute.coding) {
            Card(title: "Vibe Coding", systemImage: "chevron.left.forwardslash.chevron.right", status: active.isEmpty ? .idle : .live) {
                if let usage = store.coding {
                    HStack(alignment: .top, spacing: 20) {
                        Metric(value: Format.compact(todayTokens(usage)), caption: "Tokens today")
                        if let totals = usage.totals {
                            Metric(value: Format.compact(totals.totalTokens), caption: "All time")
                            Metric(value: Format.usd(totals.apiEquivalentCostUSD) + (totals.costComplete ? "" : "+"), caption: "API equivalent")
                        }
                    }
                    if usage.agents.contains(where: \.isPartial) {
                        Label("Partial — a source failed to update", systemImage: "exclamationmark.triangle")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                } else {
                    CardPlaceholder(text: store.failure(.coding) == nil ? "Loading…" : "Unavailable")
                }

                if !active.isEmpty {
                    Divider()
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(active) { agent in
                            HStack(spacing: 8) {
                                LiveDot()
                                Text(CodingAgentNames.label(agent.id)).font(.subheadline.weight(.medium))
                                Image(systemName: agent.isCloud ? "cloud.fill" : "laptopcomputer")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .accessibilityLabel(agent.isCloud ? "Cloud" : "Mac")
                                Spacer()
                                if let model = agent.model {
                                    Text(model).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                }
                            }
                        }
                    }
                }
            }
        }
        .buttonStyle(.plain)
    }

    private func todayTokens(_ usage: CodingUsagePayload) -> Double {
        let today = SiteDay.string(now)
        return usage.agents.compactMap(\.lastDay).filter { $0.date == today }.reduce(0) { $0 + $1.totalTokens }
    }
}

struct CodingDetailView: View {
    @Environment(LiveStore.self) private var store

    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { context in
            ScrollView {
                VStack(spacing: 14) {
                    if let year = store.codingYear {
                        Card(title: "Last 12 Months", systemImage: "square.grid.3x3.fill") {
                            TokenHeatmap(year: year)
                        }
                    }
                    if let usage = store.coding {
                        Card(title: "Agents", systemImage: "person.2.fill") {
                            ForEach(usage.agents.filter { !CodingAgentNames.isHidden($0.id) }) { agent in
                                AgentUsageRow(agent: agent, today: SiteDay.string(context.date))
                            }
                        }
                        if !usage.topModels.isEmpty {
                            Card(title: "Top Models", systemImage: "cpu") {
                                ForEach(usage.topModels, id: \.model) { model in
                                    HStack {
                                        Text(model.model).font(.subheadline).lineLimit(1)
                                        Spacer()
                                        Text(Format.compact(model.tokens)).font(.subheadline.weight(.medium)).monospacedDigit()
                                    }
                                }
                            }
                        }
                    }
                    if let limits = store.limits {
                        Card(title: "Plan Limits", systemImage: "gauge.with.dots.needle.33percent") {
                            ForEach(limits.agents.keys.sorted(), id: \.self) { id in
                                if let row = limits.agents[id] {
                                    LimitsRow(id: id, row: row, stale: store.limitsAreStale(row, now: context.date))
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal)
                .padding(.bottom, 24)
            }
        }
        .pageBackground()
        .navigationTitle("Vibe Coding")
        .toolbarMinimizationBehavior(.onScrollDown, for: .navigationBar)
        .refreshable { await store.refresh([.coding, .codingYear, .limits, .codingNow]) }
    }
}

private struct AgentUsageRow: View {
    let agent: CodingUsageAgentView
    let today: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(CodingAgentNames.label(agent.id)).font(.subheadline.weight(.semibold))
                if agent.isPartial {
                    Text("Partial").font(.caption2.weight(.semibold)).foregroundStyle(.orange)
                }
                Spacer()
                if let day = agent.lastDay {
                    Text(Format.compact(day.totalTokens)).font(.subheadline.weight(.medium)).monospacedDigit()
                }
            }
            HStack {
                Text(agent.latestModel ?? "No model")
                Spacer()
                if let day = agent.lastDay {
                    // 最近一天不是今天就写明是哪天
                    Text(day.date == today ? "Today" : day.date)
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }
}

private struct LimitsRow: View {
    let id: String
    let row: AgentLimitsRow
    let stale: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(CodingAgentNames.label(id)).font(.subheadline.weight(.semibold))
                Spacer()
                if let plan = row.plan {
                    Text(plan.label).font(.caption).foregroundStyle(.secondary)
                }
            }
            if stale {
                // 太久没更新的余量不给看，别让人拿停住的数当此刻的
                Text("Unavailable").font(.caption).foregroundStyle(.secondary)
            } else if row.limits.isEmpty {
                Text(row.limitsError ?? "No limits reported").font(.caption).foregroundStyle(.secondary)
            } else {
                ForEach(row.limits) { limit in
                    VStack(alignment: .leading, spacing: 3) {
                        HStack {
                            Text(limit.label ?? LimitWindow.label(minutes: limit.windowMinutes))
                            Spacer()
                            Text(Format.percent(limit.usedPercent)).monospacedDigit()
                        }
                        .font(.caption)
                        ProgressView(value: min(max(limit.usedPercent, 0), 100), total: 100)
                            .tint(limit.usedPercent >= 90 ? Color.red : (limit.usedPercent >= 70 ? Color.orange : Color.primary))
                        if let resets = limit.resetsAt {
                            // resetsAt 是 Unix 秒
                            Text("Resets \(Date(timeIntervalSince1970: resets), format: .relative(presentation: .named))")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }
}

/**
 年度 token 热力图：一列一周、一行一天，颜色按当天用量在全年里的分位分五档（和站点的格子一个意思）。
 用 Canvas 画，365 格不值得各起一个视图。
 */
private struct TokenHeatmap: View {
    let year: CodingYearPayload

    var body: some View {
        let cells = cellsByWeek()
        let thresholds = quantiles()
        ScrollView(.horizontal) {
            Canvas { context, size in
                let side = (size.height - 6 * 3) / 7
                for (week, days) in cells.enumerated() {
                    for (weekday, tokens) in days {
                        let rect = CGRect(x: CGFloat(week) * (side + 3), y: CGFloat(weekday) * (side + 3), width: side, height: side)
                        context.fill(Path(roundedRect: rect, cornerRadius: 2.5), with: .color(color(tokens, thresholds)))
                    }
                }
            }
            .frame(width: CGFloat(cells.count) * 15, height: 7 * 12 + 6 * 3)
        }
        .scrollIndicators(.hidden)
        .defaultScrollAnchor(.trailing)
    }

    /// 周 → [(星期几 0–6, token)]，第 0 列从 origin 那天所在的周开始
    private func cellsByWeek() -> [[(Int, Double)]] {
        guard let origin = Self.parse(year.origin) else { return [] }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = SiteDay.timeZone
        let offset = calendar.component(.weekday, from: origin) - 1
        var weeks: [[(Int, Double)]] = []
        for (index, tokens) in year.days.enumerated() {
            let slot = index + offset
            let week = slot / 7
            while weeks.count <= week { weeks.append([]) }
            weeks[week].append((slot % 7, tokens))
        }
        return weeks
    }

    private func quantiles() -> [Double] {
        let active = year.days.filter { $0 > 0 }.sorted()
        guard !active.isEmpty else { return [] }
        return [0.25, 0.5, 0.75].map { active[min(active.count - 1, Int(Double(active.count) * $0))] }
    }

    private func color(_ tokens: Double, _ thresholds: [Double]) -> Color {
        guard tokens > 0 else { return Color.secondary.opacity(0.15) }
        let level = thresholds.filter { tokens > $0 }.count
        return Color.live.opacity([0.3, 0.5, 0.75, 1][level])
    }

    private static func parse(_ day: String) -> Date? {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = SiteDay.timeZone
        return formatter.date(from: day)
    }
}
