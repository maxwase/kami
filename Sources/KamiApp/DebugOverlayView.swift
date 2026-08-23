import SwiftUI

struct DebugOverlayView: View {
    let faceCount: Int
    let status: String

    var body: some View {
        HStack(spacing: 12) {
            Label("\(faceCount) faces", systemImage: "square.3.layers.3d")
            Text(status)
        }
        .font(.caption.monospacedDigit())
        .foregroundStyle(.secondary)
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .foldFlowGlassPanel()
        .accessibilityElement(children: .combine)
    }
}
