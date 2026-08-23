import SwiftUI

extension View {
    @ViewBuilder
    func foldFlowGlassPanel() -> some View {
        if #available(iOS 26, *) {
            self.glassEffect(.regular, in: .rect(cornerRadius: 24))
        } else {
            self.background(.ultraThinMaterial, in: .rect(cornerRadius: 24))
                .overlay {
                    RoundedRectangle(cornerRadius: 24)
                        .stroke(.white.opacity(0.22), lineWidth: 0.5)
                }
        }
    }
}
