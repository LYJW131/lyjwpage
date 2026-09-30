import SwiftUI

struct ActivityRings: View {
    let move: Double
    let exercise: Double
    let stand: Double
    var lineWidth: CGFloat = 11
    var spacing: CGFloat = 3

    var body: some View {
        ZStack {
            ring(move, color: .moveRing, inset: 0)
            ring(exercise, color: .exerciseRing, inset: lineWidth + spacing)
            ring(stand, color: .standRing, inset: (lineWidth + spacing) * 2)
        }
        .animation(.spring(duration: 0.8), value: [move, exercise, stand])
    }

    private func ring(_ ratio: Double, color: Color, inset: CGFloat) -> some View {
        ZStack {
            Circle().stroke(color.opacity(0.2), lineWidth: lineWidth)
            // 圆头笔在 0% 时也会点出一个点，真的是 0 就整条不画
            if ratio > 0 {
                Circle()
                    .trim(from: 0, to: min(ratio, 1))
                    .stroke(color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                    .rotationEffect(.degrees(-90))
            }
        }
        .padding(inset + lineWidth / 2)
    }
}

extension Color {
    static let moveRing = Color(red: 0.98, green: 0.07, blue: 0.31)
    static let exerciseRing = Color(red: 0.57, green: 0.91, blue: 0.16)
    static let standRing = Color(red: 0.12, green: 0.92, blue: 0.94)
    static let live = Color(red: 0.19, green: 0.78, blue: 0.36)
}
