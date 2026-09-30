import SwiftUI

/**
 页头：Mac 此刻的前台应用，对应站点页头中间那一块。

 图标和名字由 Mac 上报器上报；窗口标题只有通过隐私判断的才会带过来，没有就不写。
 站点对几款常用工具换成了品牌动画，App 这边用上报的原图标，不另做。
 */
struct MacHeader: View {
    @Environment(LiveStore.self) private var store
    let now: Date

    var body: some View {
        HStack(spacing: 14) {
            icon
                .frame(width: 52, height: 52)
                .clipShape(.rect(cornerRadius: 12, style: .continuous))

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.headline)
                    .lineLimit(1)
                    .contentTransition(.opacity)
                if let subtitle {
                    Text(subtitle)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                        .contentTransition(.opacity)
                }
            }
            Spacer(minLength: 0)
            LocalClock(timezone: store.timezone?.timezone)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(uiColor: .secondarySystemGroupedBackground), in: .rect(cornerRadius: 26, style: .continuous))
        .animation(.smooth, value: title)
        .accessibilityElement(children: .combine)
    }

    private var state: MacState { store.macState(now: now) }

    private var title: String {
        switch state {
        case let .app(activity): activity.applicationName
        case .hidden: "Hidden"
        case .locked: "Locked"
        case .offline: "Mac Offline"
        case .unknown: "Mac"
        }
    }

    private var subtitle: String? {
        switch state {
        case let .app(activity): activity.windowTitle
        case .hidden: "Foreground app is private right now"
        case .locked: "Lock screen"
        case .offline:
            store.desktop.map { "Last seen \(Format.relative(Date(epochMilliseconds: $0.lastSeenAt), now: now))" }
        case .unknown: nil
        }
    }

    @ViewBuilder
    private var icon: some View {
        switch state {
        case let .app(activity):
            if let url = AssetURL.resolve(activity.iconUrl) {
                RemoteImage(url: url, contentMode: .fit)
            } else {
                fallbackIcon("macwindow")
            }
        case .hidden: fallbackIcon("eye.slash")
        case .locked: fallbackIcon("lock.fill")
        case .offline, .unknown: fallbackIcon("laptopcomputer.slash")
        }
    }

    private func fallbackIcon(_ symbol: String) -> some View {
        Image(systemName: symbol)
            .font(.title2)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(.quaternary)
    }
}

/// Mac 所在时区的时钟：人在哪儿，站点就按哪儿的时间说话。没取到就用站点默认时区
private struct LocalClock: View {
    let timezone: TimezoneActivity?

    var body: some View {
        let zone = timezone.flatMap { TimeZone(identifier: $0.identifier) } ?? TimeZone(identifier: "Asia/Shanghai") ?? .current
        TimelineView(.everyMinute) { context in
            VStack(alignment: .trailing, spacing: 2) {
                Text(context.date, format: Self.style(zone))
                    .font(.title3.weight(.semibold))
                    .monospacedDigit()
                Text(timezone?.abbreviation ?? zone.abbreviation() ?? zone.identifier)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private static func style(_ zone: TimeZone) -> Date.FormatStyle {
        var style = Date.FormatStyle.dateTime.hour().minute().locale(Format.locale)
        style.timeZone = zone
        return style
    }
}
