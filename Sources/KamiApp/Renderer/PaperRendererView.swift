import KamiCore
import MetalKit
import UIKit

@MainActor
final class PaperRendererView: MTKView, MTKViewDelegate {
    var renderFrame: RenderFrame? {
        didSet { setNeedsDisplay() }
    }

    var renderErrorHandler: ((RenderFrameRendererError) -> Void)?

    private var frameRenderer: RenderFrameRenderer?

    init(frameRenderer: RenderFrameRenderer) {
        self.frameRenderer = frameRenderer
        super.init(frame: .zero, device: frameRenderer.metalDevice)
        configure()
    }

    required init(coder: NSCoder) {
        super.init(coder: coder)
        frameRenderer = try? RenderFrameRenderer()
        device = frameRenderer?.metalDevice
        configure()
    }

    func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

    func draw(in view: MTKView) {
        guard
            let frameRenderer,
            let renderFrame,
            let drawable = view.currentDrawable,
            bounds.width > 0,
            bounds.height > 0
        else { return }

        do {
            _ = try frameRenderer.draw(frame: renderFrame, in: bounds.size, to: drawable.texture)
            drawable.present()
        } catch let error as RenderFrameRendererError {
            renderErrorHandler?(error)
        } catch {
            renderErrorHandler?(.commandExecutionFailed)
        }
    }

    private func configure() {
        colorPixelFormat = .bgra8Unorm_srgb
        framebufferOnly = false
        delegate = self
        preferredFramesPerSecond = 60
        enableSetNeedsDisplay = false
        isPaused = false
    }
}
