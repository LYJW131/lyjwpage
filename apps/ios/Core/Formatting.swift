import Foundation

extension Date {
    init(epochMilliseconds: Double) {
        self.init(timeIntervalSince1970: epochMilliseconds / 1000)
    }

    var epochMilliseconds: Double { timeIntervalSince1970 * 1000 }
}

enum ISO8601Parsing {
    static func date(_ text: String?) -> Date? {
        guard let text else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: text) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: text)
    }
}

enum AssetURL {
    static func resolve(_ path: String?) -> URL? {
        guard let path, !path.isEmpty else { return nil }
        if path.hasPrefix("/") { return URL(string: path, relativeTo: SiteHosts.site)?.absoluteURL }
        return URL(string: path)
    }

    // 规则须与站点 `src/lib/apple-artwork.ts#appleArtwork` 一致（jpg 换 webp、裁切 sr）；points 是展示尺寸，这里按屏幕倍数放大。
    static func appleArtwork(_ template: String?, points: Double, scale: Double = 3) -> URL? {
        guard let template, !template.isEmpty else { return nil }
        let size = String(max(1, Int((points * scale).rounded())))
        var url = template
        if let range = url.range(of: #"(/\{w\}x\{h\}[^/?]*\.)jpe?g(?=[?#]|$)"#, options: [.regularExpression, .caseInsensitive]) {
            let matched = String(url[range])
            url.replaceSubrange(range, with: matched.replacingOccurrences(
                of: #"jpe?g$"#, with: "webp", options: [.regularExpression, .caseInsensitive]
            ))
        }
        url = url
            .replacingOccurrences(of: "{w}", with: size)
            .replacingOccurrences(of: "{h}", with: size)
            .replacingOccurrences(of: "{f}", with: "webp")
            .replacingOccurrences(of: "{c}", with: "sr")
        return URL(string: url)
    }
}

enum Format {
    static let locale = Locale(identifier: "en_US")

    static func compact(_ value: Double) -> String {
        let magnitude = abs(value)
        let (divisor, suffix): (Double, String) = switch magnitude {
        case 1e12...: (1e12, "T")
        case 1e9...: (1e9, "B")
        case 1e6...: (1e6, "M")
        case 1e3...: (1e3, "K")
        default: (1, "")
        }
        let scaled = value / divisor
        if suffix.isEmpty { return integer(value) }
        let digits = abs(scaled) >= 100 ? 0 : (abs(scaled) >= 10 ? 1 : 2)
        return scaled.formatted(.number.precision(.fractionLength(0...digits)).locale(locale)) + suffix
    }

    static func integer(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(0)).locale(locale))
    }

    static func decimal(_ value: Double, digits: Int = 1) -> String {
        value.formatted(.number.precision(.fractionLength(0...digits)).locale(locale))
    }

    static func usd(_ value: Double) -> String {
        value.formatted(.currency(code: "USD").precision(.fractionLength(value >= 1000 ? 0 : 2)).locale(locale))
    }

    static func percent(_ value: Double, digits: Int = 0) -> String {
        (value / 100).formatted(.percent.precision(.fractionLength(0...digits)).locale(locale))
    }

    static func bytes(_ value: Double) -> String {
        ByteCountFormatter.string(fromByteCount: Int64(value), countStyle: .binary)
    }

    static func bytesPerSecond(_ value: Double) -> String {
        bytes(value) + "/s"
    }

    static func watts(_ value: Double) -> String {
        decimal(value, digits: value < 10 ? 1 : 0) + " W"
    }

    static func clock(milliseconds: Double) -> String {
        let total = max(0, Int(milliseconds / 1000))
        let hours = total / 3600, minutes = (total % 3600) / 60, seconds = total % 60
        return hours > 0
            ? String(format: "%d:%02d:%02d", hours, minutes, seconds)
            : String(format: "%d:%02d", minutes, seconds)
    }

    static func duration(seconds: Double) -> String {
        let total = max(0, Int(seconds.rounded()))
        let days = total / 86_400, hours = (total % 86_400) / 3600, minutes = (total % 3600) / 60
        if days > 0 { return hours > 0 ? "\(days)d \(hours)h" : "\(days)d" }
        if hours > 0 { return minutes > 0 ? "\(hours)h \(minutes)m" : "\(hours)h" }
        if minutes > 0 { return "\(minutes)m" }
        return "\(total)s"
    }

    static func distance(meters: Double) -> String {
        meters >= 1000 ? decimal(meters / 1000, digits: 2) + " km" : integer(meters) + " m"
    }

    static func relative(_ date: Date, now: Date = Date()) -> String {
        let seconds = now.timeIntervalSince(date)
        if seconds < 45 { return "just now" }
        if seconds < 7 * 86_400 {
            return date.formatted(.relative(presentation: .named, unitsStyle: .abbreviated).locale(locale))
        }
        return date.formatted(.dateTime.month(.abbreviated).day().locale(locale))
    }

    static func stamp(_ date: Date) -> String {
        date.formatted(.dateTime.month(.abbreviated).day().hour().minute().locale(locale))
    }

    // 按事发地时区而非手机当前时区写，训练和手表那一天才不会错位。
    static func stamp(_ date: Date, secondsFromGMT: Int) -> String {
        var style = Date.FormatStyle.dateTime.month(.abbreviated).day().hour().minute().locale(locale)
        style.timeZone = TimeZone(secondsFromGMT: secondsFromGMT) ?? .current
        return date.formatted(style)
    }

    static func shortSHA(_ sha: String?) -> String {
        guard let sha else { return "—" }
        return String(sha.prefix(7))
    }
}

enum SiteDay {
    // 「今天」按站点时区算，不按手机所在时区。源：src/lib/site.ts#site（`timezone` 字段）
    static let timeZone = TimeZone(identifier: "Asia/Shanghai")!

    static func string(_ date: Date) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }
}

// 源：src/lib/coding-agents.ts#CODING_AGENTS
enum CodingAgentNames {
    static func label(_ id: String) -> String {
        switch id {
        case "claude": "Claude Code"
        case "cursor": "Cursor"
        case "codex": "Codex"
        case "grok": "Grok Build"
        case "antigravity": "Antigravity"
        case "opencode": "OpenCode"
        case "pi": "Pi"
        default: id.prefix(1).uppercased() + id.dropFirst()
        }
    }

    // 与站点一致：标为 hidden 的 agent 不单列。
    static func isHidden(_ id: String) -> Bool { id == "opencode" || id == "pi" }
}

enum LimitWindow {
    static func label(minutes: Double?) -> String {
        guard let minutes else { return "Window" }
        switch minutes {
        case ..<(24 * 60): return Format.decimal(minutes / 60, digits: 0) + "h"
        case (24 * 60)..<(7 * 24 * 60): return Format.decimal(minutes / 1440, digits: 0) + "d"
        case (7 * 24 * 60)..<(28 * 24 * 60): return "Weekly"
        default: return "Monthly"
        }
    }
}
