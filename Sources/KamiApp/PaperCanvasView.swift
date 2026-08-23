import KamiCore
import SwiftUI

struct PaperCanvasView: UIViewRepresentable {
    let frameRenderer: RenderFrameRenderer
    let renderFrame: RenderFrame
    let accessibilityValue: String

    func makeUIView(context: Context) -> PaperRendererView {
        let view = PaperRendererView(frameRenderer: frameRenderer)
        view.isAccessibilityElement = true
        view.accessibilityLabel = "Paper canvas"
        view.accessibilityValue = accessibilityValue
        return view
    }

    func updateUIView(_ view: PaperRendererView, context: Context) {
        if view.renderFrame != renderFrame {
            view.renderFrame = renderFrame
        }
        if view.accessibilityValue != accessibilityValue {
            view.accessibilityValue = accessibilityValue
        }
    }
}
