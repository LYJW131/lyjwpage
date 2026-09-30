import SwiftUI

/**
 内容层的卡片。

 液态玻璃只给控件和导航那一层（Tab 栏、工具栏、浮在媒体上的按钮），内容层用系统的分组背景：
 HIG「Materials」明确说别把玻璃铺进内容层。卡片之间的层次靠 grouped 背景的明暗差，和
 系统「健康」「设置」一个做法。
 */
struct Card<Content: View>: View {
    var title: String
    var systemImage: String
    var status: CardStatus?
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                Label(title, systemImage: systemImage)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .labelStyle(.titleAndIcon)
                Spacer(minLength: 8)
                if let status { StatusPill(status: status) }
            }
            content
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(uiColor: .secondarySystemGroupedBackground), in: .rect(cornerRadius: 26, style: .continuous))
    }
}

/// 卡片右上角那个状态：和站点卡片一样只分这几种，文案也一样
enum CardStatus: Equatable {
    case live
    case idle
    case offline
    case unavailable
    case stale(Date)
    case text(String)

    var label: String {
        switch self {
        case .live: "Live"
        case .idle: "Idle"
        case .offline: "Offline"
        case .unavailable: "Unavailable"
        case let .stale(date): "Updated \(Format.relative(date))"
        case let .text(text): text
        }
    }
}

struct StatusPill: View {
    let status: CardStatus

    var body: some View {
        HStack(spacing: 5) {
            if status == .live { LiveDot() }
            Text(status.label)
        }
        .font(.caption.weight(.medium))
        .foregroundStyle(status == .live ? Color.primary : Color.secondary)
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(.quaternary.opacity(0.6), in: .capsule)
    }
}

/// 站点的 `--live` 绿点：这一路此刻是活的
struct LiveDot: View {
    var size: CGFloat = 7

    var body: some View {
        Circle()
            .fill(Color.live)
            .frame(width: size, height: size)
            .phaseAnimator([1.0, 0.45]) { dot, phase in
                dot.opacity(phase)
            } animation: { _ in .easeInOut(duration: 1.1) }
            .accessibilityHidden(true)
    }
}

/**
 远程图片。用 iOS 27 的 `AsyncImage(request:)`：请求带 `returnCacheDataElseLoad`，配合根视图
 挂的 `asyncImageURLSession` 走磁盘缓存 —— 这些图都是内容地址或带尺寸的 CDN 地址，不会原地变。
 */
struct RemoteImage: View {
    let url: URL?
    var contentMode: ContentMode = .fill

    var body: some View {
        AsyncImage(request: url.map { URLRequest(url: $0, cachePolicy: .returnCacheDataElseLoad) }) { image in
            image
                .resizable()
                .aspectRatio(contentMode: contentMode)
        } placeholder: {
            Rectangle().fill(.quaternary)
        }
    }
}

/// 一格读数：大号数字 + 小号单位 + 说明
struct Metric: View {
    let value: String
    var unit: String?
    let caption: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(value)
                    .font(.title3.weight(.semibold))
                    .monospacedDigit()
                    .contentTransition(.numericText())
                if let unit {
                    Text(unit).font(.caption).foregroundStyle(.secondary)
                }
            }
            Text(caption)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

/// 卡片里「这一路还没数据 / 取不到」的占位
struct CardPlaceholder: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
    }
}

extension Color {
    /// `#rrggbb`，站点给专辑配色用的格式
    init?(hex: String) {
        let digits = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        guard digits.count == 6, let value = UInt32(digits, radix: 16) else { return nil }
        self.init(
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }
}

extension View {
    /// 页面底色：分组背景，卡片浮在上面
    func pageBackground() -> some View {
        background(Color(uiColor: .systemGroupedBackground).ignoresSafeArea())
    }
}
