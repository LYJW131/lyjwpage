import Foundation

// 对着站点 `src/lib/live-events.ts#LiveEvent`。
// 认不出的类型落到 .unknown：站点先加事件、App 后发版时不能让整条连接报错。
enum LiveEvent: Sendable {
    case desktop(DesktopPayload)
    case nowListening(NowListeningPayload)
    case listening(ListeningPayload)
    case charger(ChargerPayload)
    case powerBank(PowerBankPayload)
    case codingNow(CodingNowPayload)
    case nowWatching(NowWatchingPayload)
    case watching(WatchingPayload)
    case playingNow(PlaystationPresencePayload)
    case playing(PlaystationPlayingPayload)
    case trophies(TrophiesSummaryPayload)
    case presence
    case version
    case online(Int)
    case unknown(String)
}

extension LiveEvent: Decodable {
    private enum CodingKeys: String, CodingKey { case type, payload }
    private struct Online: Decodable { let online: Int }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)
        func payload<T: Decodable>(_: T.Type) throws -> T {
            try container.decode(T.self, forKey: .payload)
        }
        switch type {
        case "desktop": self = .desktop(try payload(DesktopPayload.self))
        case "listening-now": self = .nowListening(try payload(NowListeningPayload.self))
        case "listening": self = .listening(try payload(ListeningPayload.self))
        case "charger": self = .charger(try payload(ChargerPayload.self))
        case "powerbank": self = .powerBank(try payload(PowerBankPayload.self))
        case "coding-now": self = .codingNow(try payload(CodingNowPayload.self))
        case "watching-now": self = .nowWatching(try payload(NowWatchingPayload.self))
        case "watching": self = .watching(try payload(WatchingPayload.self))
        case "playing-now": self = .playingNow(try payload(PlaystationPresencePayload.self))
        case "playing": self = .playing(try payload(PlaystationPlayingPayload.self))
        case "trophies": self = .trophies(try payload(TrophiesSummaryPayload.self))
        case "presence": self = .presence
        case "version": self = .version
        case "online": self = .online(try payload(Online.self).online)
        default: self = .unknown(type)
        }
    }
}
