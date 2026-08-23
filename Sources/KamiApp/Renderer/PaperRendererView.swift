import KamiCore
import MetalKit
import UIKit

@MainActor
final class PaperRendererView: MTKView, MTKViewDelegate {
    var renderFrame: RenderFrame? {
        didSet { setNeedsDisplay() }
    }

    var renderErrorHandler: ((RenderFrameRendererError) -> Void)?
    var renderIssueHandler: ((FaceRenderFailure) -> Void)?
    var drawablePresentationHandler: ((ObjectIdentifier) -> Void)?

    private(set) var lastRenderResult: RenderPassResult?

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

    @discardableResult
    func render(frame: RenderFrame, present: Bool = true) throws -> RenderPassResult {
        guard
            let frameRenderer,
            let drawable = currentDrawable,
            bounds.width > 0,
            bounds.height > 0
        else { throw RenderFrameRendererError.drawableUnavailable }

        let drawableTextureIdentity = ObjectIdentifier(drawable.texture as AnyObject)
        let result = try frameRenderer.draw(
            frame: frame,
            in: bounds.size,
            to: drawable.texture,
            presenting: present ? drawable : nil
        )
        lastRenderResult = result
        result.faceFailures.forEach { renderIssueHandler?($0) }
        if present {
            drawablePresentationHandler?(drawableTextureIdentity)
        }
        return result
    }

    func draw(in view: MTKView) {
        guard let renderFrame else { return }

        do {
            try render(frame: renderFrame)
        } catch RenderFrameRendererError.drawableUnavailable {
            return
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
