import SwiftUI

/// 落地节点：位置、上下行、本计费周期流量、CPU 与内存。超过 `serverStaleMs` 没报写 Unavailable
struct ServerCard: View {
    @Environment(LiveStore.self) private var store
    let now: Date

    var body: some View {
        Card(title: "Exit Node", systemImage: "server.rack", status: store.serverIsStale(now: now) ? .unavailable : .live) {
            if let server = store.server, !store.serverIsStale(now: now) {
                VStack(alignment: .leading, spacing: 2) {
                    Text([server.city, server.country].compactMap { $0 }.joined(separator: ", "))
                        .font(.headline)
                    Text(server.isp ?? server.hostname)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                HStack(spacing: 20) {
                    Metric(value: Format.bytesPerSecond(server.networkRxBytesPerSec), caption: "Down")
                    Metric(value: Format.bytesPerSecond(server.networkTxBytesPerSec), caption: "Up")
                }
                if let traffic = server.traffic {
                    TrafficBar(traffic: traffic)
                }
                HStack(spacing: 20) {
                    Gauge(value: min(max(server.cpuUsagePercent, 0), 100), in: 0...100) {
                        Text("CPU")
                    } currentValueLabel: {
                        Text(Format.integer(server.cpuUsagePercent))
                    }
                    Gauge(value: server.memoryUsedBytes, in: 0...max(server.memoryTotalBytes, 1)) {
                        Text("RAM")
                    } currentValueLabel: {
                        Text(Format.integer(server.memoryUsedBytes / max(server.memoryTotalBytes, 1) * 100))
                    }
                    Spacer()
                    Metric(value: Format.duration(seconds: server.uptimeSeconds), caption: "Uptime")
                }
                .gaugeStyle(.accessoryCircular)
                .monospacedDigit()
            } else {
                CardPlaceholder(text: "Unavailable")
            }
        }
    }
}

private struct TrafficBar: View {
    let traffic: ServerTraffic

    var body: some View {
        let used = traffic.rxBytes + traffic.txBytes
        VStack(alignment: .leading, spacing: 4) {
            if let quota = traffic.quotaBytes, quota > 0 {
                ProgressView(value: min(used, quota), total: quota)
                    .tint(.primary)
            }
            HStack {
                Text("\(Format.bytes(used)) this cycle")
                Spacer()
                Text("Resets \(Date(epochMilliseconds: traffic.cycleEnd), format: .dateTime.month(.abbreviated).day())")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .monospacedDigit()
        }
    }
}

/**
 PlayStation：在线状态、正在玩的游戏、奖杯总数。点进去是游戏记录和最近奖杯。
 在线状态超过 `playstationStaleMs` 没更新时不当作此刻。
 */
struct PlayStationCard: View {
    @Environment(LiveStore.self) private var store
    let now: Date

    var body: some View {
        NavigationLink(value: NowRoute.playstation) {
            Card(title: "PlayStation", systemImage: "gamecontroller.fill", status: status) {
                if let presence = store.playingNow, !store.playstationIsStale(now: now), let game = presence.playing {
                    HStack(spacing: 12) {
                        RemoteImage(url: AssetURL.resolve(game.iconUrl))
                            .frame(width: 56, height: 56)
                            .clipShape(.rect(cornerRadius: 12, style: .continuous))
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Playing").font(.caption).foregroundStyle(.secondary)
                            Text(game.title).font(.headline).lineLimit(2)
                            Text(presence.platform ?? "").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                } else if let last = store.playing?.items.first {
                    HStack(spacing: 12) {
                        RemoteImage(url: AssetURL.resolve(last.imageUrl))
                            .frame(width: 56, height: 56)
                            .clipShape(.rect(cornerRadius: 12, style: .continuous))
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Last played").font(.caption).foregroundStyle(.secondary)
                            Text(last.name).font(.headline).lineLimit(2)
                            if let at = last.lastPlayedAt {
                                Text(Format.relative(Date(epochMilliseconds: at), now: now))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                } else {
                    CardPlaceholder(text: "Unavailable")
                }

                if let trophies = store.trophies {
                    TrophyCountsRow(counts: trophies.earned, level: trophies.profile.level)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("now.playstation")
    }

    private var status: CardStatus {
        guard let presence = store.playingNow, !store.playstationIsStale(now: now) else { return .unavailable }
        if presence.playing != nil { return .live }
        return presence.online ? .text("Online") : .offline
    }
}

struct TrophyCountsRow: View {
    let counts: TrophyCounts
    let level: Int

    var body: some View {
        HStack(spacing: 14) {
            Label("Lv \(level)", systemImage: "star.circle.fill")
            trophy("P", counts.platinum, Color(red: 0.62, green: 0.72, blue: 0.86))
            trophy("G", counts.gold, Color(red: 0.86, green: 0.68, blue: 0.24))
            trophy("S", counts.silver, Color(red: 0.7, green: 0.72, blue: 0.75))
            trophy("B", counts.bronze, Color(red: 0.72, green: 0.47, blue: 0.3))
        }
        .font(.caption.weight(.medium))
        .monospacedDigit()
    }

    private func trophy(_ label: String, _ count: Int, _ color: Color) -> some View {
        HStack(spacing: 3) {
            Image(systemName: "trophy.fill").foregroundStyle(color)
            Text("\(count)")
        }
        .accessibilityLabel("\(count) \(label == "P" ? "platinum" : label == "G" ? "gold" : label == "S" ? "silver" : "bronze")")
    }
}

struct PlayStationDetailView: View {
    @Environment(LiveStore.self) private var store

    var body: some View {
        List {
            if let trophies = store.trophies {
                Section("Trophies") {
                    TrophyCountsRow(counts: trophies.earned, level: trophies.profile.level)
                    ForEach(trophies.recent, id: \.uniqueID) { unlock in
                        HStack(spacing: 12) {
                            RemoteImage(url: AssetURL.resolve(unlock.iconUrl))
                                .frame(width: 40, height: 40)
                                .clipShape(.rect(cornerRadius: 8, style: .continuous))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(unlock.trophyName).font(.subheadline.weight(.medium))
                                Text(unlock.titleName).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(Format.relative(Date(epochMilliseconds: unlock.earnedAt)))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
            if let games = store.playing?.items, !games.isEmpty {
                Section("Games") {
                    ForEach(games) { game in
                        GameRow(game: game, digest: store.trophies?.titles.first(where: { $0.titleIds.contains(game.titleId) }))
                    }
                }
            }
        }
        .navigationTitle("PlayStation")
        // 从收起工具栏的 Now 推入 List 时，保持导航栏稳定，避免转场中的安全区布局循环。
        .navigationBarTitleDisplayMode(.inline)
        .toolbarMinimizationBehavior(.never, for: .navigationBar)
        .refreshable { await store.refresh([.playing, .playingNow, .trophies]) }
    }
}

struct GameRow: View {
    let game: PlaystationGame
    let digest: TrophyTitleDigest?

    var body: some View {
        HStack(spacing: 12) {
            RemoteImage(url: AssetURL.resolve(game.imageUrl))
                .frame(width: 48, height: 48)
                .clipShape(.rect(cornerRadius: 10, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                Text(game.name).font(.subheadline.weight(.medium)).lineLimit(1)
                HStack(spacing: 8) {
                    if let ms = game.playDurationMs { Text(Format.duration(seconds: ms / 1000)) }
                    if let at = game.lastPlayedAt { Text(Format.relative(Date(epochMilliseconds: at))) }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                if let digest {
                    ProgressView(value: min(max(digest.progress, 0), 100), total: 100)
                        .tint(.primary)
                }
            }
        }
    }
}

/// 服务商状态：编码 agent 与站点依赖的几家的状态页汇总，有事故时列出来
struct ProviderStatusCard: View {
    @Environment(LiveStore.self) private var store
    let now: Date

    var body: some View {
        Card(title: "Provider Status", systemImage: "checkmark.shield.fill", status: status) {
            if let payload = store.agentStatus {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), spacing: 10, alignment: .leading)], alignment: .leading, spacing: 10) {
                    ForEach(payload.agents) { row in
                        Link(destination: URL(string: row.statusUrl) ?? SiteHosts.site) {
                            HStack(spacing: 6) {
                                Circle().fill(Self.color(row.indicator)).frame(width: 8, height: 8)
                                Text(row.name).font(.subheadline).lineLimit(1)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
                let incidents = payload.agents.flatMap { row in
                    row.incidents.map { ProviderIncident(provider: row.name, incident: $0) }
                }
                if !incidents.isEmpty {
                    Divider()
                    ForEach(incidents) { entry in
                        Link(destination: URL(string: entry.incident.url) ?? SiteHosts.site) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("\(entry.provider): \(entry.incident.title)").font(.subheadline.weight(.medium)).lineLimit(2)
                                Text(entry.incident.status.capitalized).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
            } else {
                CardPlaceholder(text: "Unavailable")
            }
        }
    }

    private var status: CardStatus? {
        guard let payload = store.agentStatus else { return nil }
        let degraded = payload.agents.filter { ![.operational, .unmonitored].contains($0.indicator) }
        return degraded.isEmpty ? .text("All operational") : .text("\(degraded.count) degraded")
    }

    static func color(_ indicator: AgentIndicator) -> Color {
        switch indicator {
        case .operational: .live
        case .degraded, .maintenance: .yellow
        case .partialOutage: .orange
        case .majorOutage: .red
        case .unavailable, .unmonitored: .secondary
        }
    }
}

private struct ProviderIncident: Identifiable {
    let provider: String
    let incident: AgentIncident

    var id: String { "\(provider)-\(incident.id)" }
}

/**
 站点自己：线上构建、仓库统计、部署、错误与在线率、两个常驻上报器。对应站点首页底部的
 「LYJWPAGE」一栏，只挑在手机上值得看的几项。
 */
struct SiteCard: View {
    @Environment(LiveStore.self) private var store
    let now: Date

    var body: some View {
        Card(title: "LYJWPAGE", systemImage: "globe", status: store.siteVersion.map { CardStatus.text(Format.shortSHA($0.commit)) }) {
            if let version = store.siteVersion, let message = version.message {
                Text(message)
                    .font(.subheadline)
                    .lineLimit(2)
            }
            HStack(spacing: 20) {
                if let totals = store.githubRepo?.totals {
                    Metric(value: Format.integer(Double(totals.commits)), caption: "Commits")
                }
                if let uptime = store.sentry?.uptime?.availability30d {
                    Metric(value: Format.percent(uptime * 100, digits: 2), caption: "30-day uptime")
                }
                if let errors = store.sentry?.errors {
                    Metric(value: Format.integer(Double((errors.site?.count12h ?? 0) + (errors.worker?.count12h ?? 0))), caption: "Errors (12h)")
                }
            }
            if let deployment = store.vercelDeployments?.production {
                LabeledContent("Vercel") {
                    Text("\(deployment.state.capitalized) · \(Format.relative(Date(epochMilliseconds: deployment.createdAt), now: now))")
                }
                .font(.subheadline)
            }
            if let workers = store.cloudflareWorkers?.workers, !workers.isEmpty {
                LabeledContent("Workers") {
                    Text("\(Format.compact(workers.compactMap(\.metrics?.requests).reduce(0, +))) requests (12h)")
                }
                .font(.subheadline)
            }
            if let reporters = store.reporters?.reporters {
                ForEach(reporters.keys.sorted(), id: \.self) { name in
                    if let block = reporters[name] ?? nil {
                        LabeledContent(name) {
                            Text("\(block.pushes) pushes · \(block.rttMs.map { "\(Format.integer($0)) ms" } ?? "—")")
                                .monospacedDigit()
                        }
                        .font(.subheadline)
                    }
                }
            }
        }
    }
}
