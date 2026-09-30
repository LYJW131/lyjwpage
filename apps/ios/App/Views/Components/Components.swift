import SwiftUI

// 液态玻璃只给控件和导航层，卡片用系统分组背景：HIG「Materials」明确说别把玻璃铺进内容层
struct Card<Content: View>: View {
    var title: String
    var systemImage: String
    var status: CardStatus?
    var tint: Color? = nil
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
        .background {
            let shape = RoundedRectangle(cornerRadius: 26, style: .continuous)
            ZStack {
                shape.fill(Color(uiColor: .secondarySystemGroupedBackground))
                if let tint {
                    shape.fill(LinearGradient(colors: [tint.opacity(0.28), .clear], startPoint: .top, endPoint: .center))
                }
            }
        }
    }
}

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

// returnCacheDataElseLoad 不回源校验：只对内容地址或带尺寸的 CDN 图成立，会原地变的图不能走这里
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
    func pageBackground() -> some View {
        background(Color(uiColor: .systemGroupedBackground).ignoresSafeArea())
    }
}
