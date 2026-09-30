import SwiftUI

struct NowWatchingCard: View {
    @Environment(LiveStore.self) private var store
    let now: Date

    var body: some View {
        if let watching = store.nowWatchingItem {
            let playing = watching.playing
            let item = watching.item
            Card(title: "Now Watching", systemImage: "play.tv.fill", status: playing.paused ? .text("Paused") : .live) {
                VStack(alignment: .leading, spacing: 12) {
                    ZStack(alignment: .bottomLeading) {
                        RemoteImage(url: AssetURL.resolve(item?.backdrop ?? item?.poster))
                            .frame(height: 180)
                            .frame(maxWidth: .infinity)
                            .clipped()
                        LinearGradient(colors: [.clear, .black.opacity(0.7)], startPoint: .center, endPoint: .bottom)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item?.title ?? "Unknown")
                                .font(.headline)
                                .lineLimit(1)
                            if let subtitle = item?.subtitle, !subtitle.isEmpty {
                                Text(subtitle).font(.caption).lineLimit(2)
                            }
                        }
                        .foregroundStyle(.white)
                        .padding(12)
                    }
                    .clipShape(.rect(cornerRadius: 16, style: .continuous))

                    if let progress = store.nowWatchingProgress(now: now) {
                        ProgressView(value: min(max(progress, 0), 100), total: 100)
                            .tint(.primary)
                    }

                    WatchingSpecs(playing: playing)
                }
            }
        }
    }
}

struct WatchingSpecs: View {
    let playing: ResolvedNowPlaying

    var body: some View {
        let tags = Self.tags(playing)
        if !tags.isEmpty {
            ScrollView(.horizontal) {
                HStack(spacing: 6) {
                    ForEach(tags, id: \.self) { tag in
                        Text(tag)
                            .font(.caption.weight(.medium))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(.quaternary.opacity(0.6), in: .capsule)
                    }
                }
            }
            .scrollIndicators(.hidden)
        }
    }

    static func tags(_ playing: ResolvedNowPlaying) -> [String] {
        var tags: [String] = []
        if let device = playing.deviceName ?? playing.client { tags.append(device) }
        if let video = playing.media?.video {
            if let height = video.height { tags.append(height >= 2000 ? "4K" : "\(height)p") }
            if let range = video.range, range != "sdr" { tags.append(Self.rangeLabel(range)) }
            if let codec = video.codec { tags.append(codec.uppercased()) }
        }
        if let audio = playing.media?.audio {
            if let codec = audio.codec { tags.append(codec.uppercased()) }
            if let layout = audio.layout { tags.append(layout) }
        }
        if let bitrate = playing.media?.bitrate { tags.append(Format.decimal(bitrate / 1_000_000, digits: 1) + " Mbps") }
        switch playing.playMethod {
        case "directplay": tags.append("Direct Play")
        case "directstream": tags.append("Direct Stream")
        case "transcode": tags.append("Transcode")
        default: break
        }
        return tags
    }

    private static func rangeLabel(_ range: String) -> String {
        switch range {
        case "dolby-vision": "Dolby Vision"
        case "hdr10plus": "HDR10+"
        case "hdr10": "HDR10"
        case "hlg": "HLG"
        default: "HDR"
        }
    }
}

struct ChargingCard: View {
    @Environment(LiveStore.self) private var store
    let now: Date

    var body: some View {
        Card(title: "Charging", systemImage: "bolt.fill", status: .live) {
            VStack(alignment: .leading, spacing: 16) {
                if let charger = store.charger, store.chargerIsActive(now: now) {
                    ChargerSection(charger: charger)
                }
                if store.chargerIsActive(now: now), store.powerBankIsActive(now: now) {
                    Divider()
                }
                if let powerBank = store.powerBank, store.powerBankIsActive(now: now) {
                    PowerBankSection(powerBank: powerBank)
                }
            }
        }
    }
}

private struct ChargerSection: View {
    let charger: ChargerPayload

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Metric(value: Format.decimal(charger.totalPower, digits: 1), unit: "W", caption: charger.device.model.map { "Anker \($0)" } ?? "Charger")
                Spacer()
                Text("of \(Format.integer(charger.maxPower)) W")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            PowerSparkline(samples: charger.history)
                .frame(height: 44)
            ForEach(charger.ports.filter(\.active)) { port in
                HStack {
                    Text(port.id).font(.caption.weight(.semibold)).monospaced()
                        .frame(width: 26, alignment: .leading)
                    Text(port.device ?? port.`protocol` ?? "Connected")
                        .font(.subheadline)
                        .lineLimit(1)
                    Spacer()
                    Text(port.power.map(Format.watts) ?? "—")
                        .font(.subheadline.weight(.medium))
                        .monospacedDigit()
                }
            }
        }
    }
}

private struct PowerBankSection: View {
    let powerBank: PowerBankPayload

    var body: some View {
        HStack(alignment: .center, spacing: 16) {
            Gauge(value: min(max(powerBank.battery ?? 0, 0), 100), in: 0...100) {
                Image(systemName: powerBank.charging ? "battery.100percent.bolt" : "battery.75percent")
            } currentValueLabel: {
                Text(powerBank.battery.map { Format.integer($0) } ?? "—")
                    .monospacedDigit()
            }
            .gaugeStyle(.accessoryCircularCapacity)
            .tint(Color.live)

            VStack(alignment: .leading, spacing: 4) {
                Text(powerBank.device.model.map { "Anker \($0)" } ?? "Power Bank")
                    .font(.subheadline.weight(.semibold))
                HStack(spacing: 12) {
                    if powerBank.inputPower > 1 { Label(Format.watts(powerBank.inputPower), systemImage: "arrow.down") }
                    if powerBank.outputPower > 1 { Label(Format.watts(powerBank.outputPower), systemImage: "arrow.up") }
                }
                .font(.caption)
                .monospacedDigit()
                .foregroundStyle(.secondary)
                if let minutes = powerBank.timeToFullMinutes, powerBank.charging {
                    Text("Full in \(Format.duration(seconds: minutes * 60))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
        }
    }
}
