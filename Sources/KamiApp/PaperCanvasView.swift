import KamiCore
import SwiftUI

struct PaperCanvasView: UIViewRepresentable {
    let frameRenderer: RenderFrameRenderer
    let renderFrame: RenderFrame

    func makeUIView(context: Context) -> PaperRendererView {
        let view = PaperRendererView(frameRenderer: frameRenderer)
        view.isAccessibilityElement = true
        view.accessibilityLabel = "Paper canvas"
        return view
    }

    func updateUIView(_ view: PaperRendererView, context: Context) {
        view.renderFrame = renderFrame
    }
}
