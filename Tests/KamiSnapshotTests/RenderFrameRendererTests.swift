import KamiCore
@testable import KamiApp
import Foundation
import SnapshotTesting
import Testing
import UIKit

@MainActor
@Suite(.serialized, .snapshots(record: .never))
struct RenderFrameRendererTests {
    @Test(arguments: [
        (name: "flat-a4-portrait", size: CGSize(width: 390, height: 844)),
        (name: "flat-a4-landscape", size: CGSize(width: 844, height: 390)),
    ])
    func flatA4Snapshot(scene: (name: String, size: CGSize)) throws {
        let rendered = try RenderFrameRenderer().render(frame: try flatA4Frame(), in: scene.size)

        #expect(rendered.processedFaceCount == 1)
        assertSnapshot(
            of: rendered.image,
            as: .image(precision: 0.97, perceptualPrecision: 0.97),
            named: scene.name
        )
    }

    @Test("Fold, layered-stack, and flipped reference scenes render in both orientations")
    func referenceSceneSnapshots() throws {
        let renderer = try RenderFrameRenderer()
        let scenes = try [
            ("folding-25-portrait", foldingA4Frame(progress: 0.25), CGSize(width: 390, height: 844)),
            ("folding-25-landscape", foldingA4Frame(progress: 0.25), CGSize(width: 844, height: 390)),
            ("folding-75-portrait", foldingA4Frame(progress: 0.75), CGSize(width: 390, height: 844)),
            ("folding-75-landscape", foldingA4Frame(progress: 0.75), CGSize(width: 844, height: 390)),
            ("layered-stack-portrait", layeredFrame(), CGSize(width: 390, height: 844)),
            ("layered-stack-landscape", layeredFrame(), CGSize(width: 844, height: 390)),
            ("flipping-25-portrait", flippingA4Frame(progress: 0.25), CGSize(width: 390, height: 844)),
            ("flipping-25-landscape", flippingA4Frame(progress: 0.25), CGSize(width: 844, height: 390)),
            ("flipping-75-portrait", flippingA4Frame(progress: 0.75), CGSize(width: 390, height: 844)),
            ("flipping-75-landscape", flippingA4Frame(progress: 0.75), CGSize(width: 844, height: 390)),
            ("flipped-committed-portrait", committedFlipFrame(), CGSize(width: 390, height: 844)),
            ("flipped-committed-landscape", committedFlipFrame(), CGSize(width: 844, height: 390)),
        ]
        for scene in scenes {
            let rendered = try renderer.render(frame: scene.1, in: scene.2)
            assertSnapshot(
                of: rendered.image,
                as: .image(precision: 0.97, perceptualPrecision: 0.97),
                named: scene.0
            )
        }
    }

    @Test("A projected edge-on face is not reported as rendered")
    func processedFaceCountIncludesOnlyEncodedFaceMeshes() throws {
        let rendered = try RenderFrameRenderer().render(
            frame: try foldingA4Frame(progress: 0.5),
            in: CGSize(width: 390, height: 844)
        )

        #expect(rendered.processedFaceCount == 1)
    }

    @Test("The crease remains clipped to the paper")
    func creaseDoesNotCrossWood() throws {
        let renderer = try RenderFrameRenderer()
        let size = CGSize(width: 390, height: 844)
        let baseline = try renderer.render(frame: try flatA4Frame(), in: size).image
        let folded = try renderer.render(frame: try foldingA4Frame(progress: 0.25), in: size).image
        let samplePoint = CGPoint(x: size.width / 2, y: 40)

        let baselinePixel = try pixel(in: baseline, at: samplePoint)
        let foldedPixel = try pixel(in: folded, at: samplePoint)
        #expect(foldedPixel == baselinePixel, "A crease pixel was encoded onto the wood background.")
    }

    @Test("An offscreen or zero-sized draw is a silent lifecycle no-op")
    func offscreenDrawDoesNotReportRendererError() throws {
        let view = PaperRendererView(frameRenderer: try RenderFrameRenderer())
        var reportedErrors: [RenderFrameRendererError] = []
        view.renderErrorHandler = { reportedErrors.append($0) }
        view.renderFrame = try flatA4Frame()

        view.draw(in: view)

        #expect(reportedErrors.isEmpty)
    }

    @Test("A diagnosed invalid face does not freeze the displayed frame")
    func invalidFaceDoesNotFreezeDisplayLifecycle() throws {
        let renderer = try RenderFrameRenderer()
        let size = CGSize(width: 390, height: 844)
        let (window, view) = makeDrawableView(renderer: renderer, size: size)
        defer { tearDown(window: window, view: view) }
        var reportedErrors: [RenderFrameRendererError] = []
        var faceFailures: [FaceRenderFailure] = []
        var presentationCount = 0
        view.renderErrorHandler = { reportedErrors.append($0) }
        view.renderIssueHandler = { faceFailures.append($0) }
        view.drawablePresentationHandler = { _ in presentationCount += 1 }

        view.renderFrame = try flatA4Frame()
        view.draw()
        view.renderFrame = try mixedValidAndInvalidFrame()
        view.draw()

        #expect(presentationCount == 2)
        #expect(view.lastRenderResult?.processedFaceCount == 1)
        #expect(reportedErrors.isEmpty)
        #expect(faceFailures.count == 1)
        #expect(faceFailures.first?.faceID == FaceID(rawValue: 2))
        #expect(faceFailures.first?.error == .triangulationFailed)
    }

    @Test(arguments: [1, 64, 256])
    func rendererProcessesEveryFace(faceCount: Int) throws {
        let rendered = try RenderFrameRenderer().render(
            frame: try stackedFrame(faceCount: faceCount),
            in: CGSize(width: 390, height: 844)
        )

        #expect(rendered.processedFaceCount == faceCount)
    }

    @Test("The renderer p95 stays within the 60 fps budget through 64 faces", arguments: [1, 64, 256])
    func rendererMeetsSixtyFramesPerSecondThrough64Faces(faceCount: Int) throws {
        let renderer = try RenderFrameRenderer()
        let frame = try stackedFrame(faceCount: faceCount)
        let size = CGSize(width: 390, height: 844)
        let (window, view) = makeDrawableView(renderer: renderer, size: size)
        defer { tearDown(window: window, view: view) }
        view.renderFrame = frame
        var reportedErrors: [RenderFrameRendererError] = []
        var reportedFaceFailures: [FaceRenderFailure] = []
        var presentedDrawableIDs: [ObjectIdentifier] = []
        view.renderErrorHandler = { reportedErrors.append($0) }
        view.renderIssueHandler = { reportedFaceFailures.append($0) }
        view.drawablePresentationHandler = { presentedDrawableIDs.append($0) }
        let clock = ContinuousClock()
        var samples: [Duration] = []
        for _ in 0..<2 {
            view.draw()
        }
        presentedDrawableIDs.removeAll(keepingCapacity: true)
        for _ in 0..<30 {
            let start = clock.now
            view.draw()
            samples.append(start.duration(to: clock.now))
        }
        #expect(view.lastRenderResult?.processedFaceCount == faceCount)
        #expect(reportedErrors.isEmpty)
        #expect(reportedFaceFailures.isEmpty)
        #expect(presentedDrawableIDs.count == 30)
        #expect(Set(presentedDrawableIDs).count >= 2, "Presented CAMetalDrawables did not rotate.")
        let sorted = samples.sorted()
        let index = Int(Double(sorted.count - 1) * 0.95)
        let readbackSamples = try (0..<10).map { _ in
            let start = clock.now
            _ = try renderer.render(frame: frame, in: size)
            return start.duration(to: clock.now)
        }
        let sortedReadback = readbackSamples.sorted()
        let readbackIndex = Int(Double(sortedReadback.count - 1) * 0.95)

        printPerformance(
            label: "display-loop",
            faceCount: faceCount,
            samples: samples,
            p95: sorted[index]
        )
        printPerformance(
            label: "snapshot-readback",
            faceCount: faceCount,
            samples: readbackSamples,
            p95: sortedReadback[readbackIndex]
        )

        if faceCount <= 64 {
            #expect(
                sorted[index] < .nanoseconds(16_700_000),
                "\(faceCount)-face p95 was \(sorted[index]); the Metal performance gate is 16.7 ms."
            )
        }

    }

    private func makeDrawableView(
        renderer: RenderFrameRenderer,
        size: CGSize
    ) -> (window: UIWindow, view: PaperRendererView) {
        let window = UIWindow(frame: CGRect(origin: .zero, size: size))
        let view = PaperRendererView(frameRenderer: renderer)
        view.frame = window.bounds
        view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.isPaused = true
        window.addSubview(view)
        window.isHidden = false
        view.layoutIfNeeded()
        view.drawableSize = CGSize(
            width: size.width * UIScreen.main.scale,
            height: size.height * UIScreen.main.scale
        )
        return (window, view)
    }

    private func tearDown(window: UIWindow, view: PaperRendererView) {
        window.isHidden = true
        view.removeFromSuperview()
    }

    private func printPerformance(
        label: String,
        faceCount: Int,
        samples: [Duration],
        p95: Duration
    ) {
        let formattedSamples = samples.map { String(format: "%.3f", milliseconds($0)) }.joined(separator: ",")
        print(
            "METAL_PERF path=\(label) faces=\(faceCount) "
                + "samples_ms=[\(formattedSamples)] p95_ms=\(String(format: "%.3f", milliseconds(p95)))"
        )
    }

    private func milliseconds(_ duration: Duration) -> Double {
        let components = duration.components
        return Double(components.seconds) * 1_000 + Double(components.attoseconds) / 1_000_000_000_000_000
    }

    private func flatA4Frame() throws -> RenderFrame {
        let paper = try Paper.rectangle(
            id: PaperID(rawValue: 1),
            faceID: FaceID(rawValue: 1),
            style: .white,
            center: .zero,
            width: 210,
            height: 297
        )
        return RenderFrame(paper: paper)
    }

    private func stackedFrame(faceCount: Int) throws -> RenderFrame {
        let base = try flatA4Frame()
        var faces: [Face] = []
        for index in 0..<faceCount {
            let offset = Double(index) / 1000
            let polygon = try Polygon(vertices: [
                Point2D(x: -100 + offset, y: -140),
                Point2D(x: 100 + offset, y: -140),
                Point2D(x: 100 + offset, y: 140),
                Point2D(x: -100 + offset, y: 140),
            ])
            faces.append(Face(
                id: FaceID(rawValue: UInt64(index + 1)),
                polygon: polygon,
                visibleSide: index.isMultiple(of: 2) ? .front : .back,
                layer: index
            ))
        }
        let paper = try Paper(
            id: base.paperID,
            style: base.style,
            center: base.transform.center,
            rotation: base.transform.rotation,
            scale: base.transform.scale,
            baseSize: .a4,
            faces: faces
        )
        return RenderFrame(paper: paper)
    }

    private func layeredFrame() throws -> RenderFrame {
        let base = try flatA4Frame()
        let polygons = try [
            Polygon(vertices: [
                Point2D(x: -105, y: -145), Point2D(x: 70, y: -145),
                Point2D(x: 70, y: 105), Point2D(x: -105, y: 105),
            ]),
            Polygon(vertices: [
                Point2D(x: -80, y: -120), Point2D(x: 95, y: -110),
                Point2D(x: 88, y: 130), Point2D(x: -72, y: 120),
            ]),
            Polygon(vertices: [
                Point2D(x: -48, y: -88), Point2D(x: 110, y: -72),
                Point2D(x: 98, y: 145), Point2D(x: -35, y: 132),
            ]),
        ]
        let faces = polygons.enumerated().map { index, polygon in
            Face(
                id: FaceID(rawValue: UInt64(index + 1)),
                polygon: polygon,
                visibleSide: index.isMultiple(of: 2) ? .front : .back,
                layer: index
            )
        }
        let paper = try Paper(
            id: base.paperID,
            style: base.style,
            center: base.transform.center,
            rotation: base.transform.rotation,
            scale: base.transform.scale,
            baseSize: .a4,
            faces: faces
        )
        return RenderFrame(paper: paper)
    }

    private func mixedValidAndInvalidFrame() throws -> RenderFrame {
        let valid = try Polygon(vertices: [
            Point2D(x: -140, y: -120), Point2D(x: -20, y: -120),
            Point2D(x: -20, y: 120), Point2D(x: -140, y: 120),
        ])
        let outer = (0..<5).map { index in
            let angle = Double(index) / 5 * 2 * Double.pi - Double.pi / 2
            return Point2D(x: 70 + cos(angle) * 65, y: sin(angle) * 65)
        }
        let invalid = try Polygon(vertices: [outer[0], outer[2], outer[4], outer[1], outer[3]])
        let paper = try Paper(
            id: PaperID(rawValue: 1),
            style: .white,
            center: .zero,
            rotation: 0,
            scale: 1,
            baseSize: .a4,
            faces: [
                Face(id: FaceID(rawValue: 1), polygon: valid, visibleSide: .front, layer: 0),
                Face(id: FaceID(rawValue: 2), polygon: invalid, visibleSide: .front, layer: 1),
            ]
        )
        return RenderFrame(paper: paper)
    }

    private func foldingA4Frame(progress: Double) throws -> RenderFrame {
        let paper = try Paper.rectangle(
            id: PaperID(rawValue: 1),
            faceID: FaceID(rawValue: 1),
            style: .white,
            center: .zero,
            width: 210,
            height: 297
        )
        let foldLine = try Line2D(point: .zero, direction: Point2D(x: 0, y: 1))
        let result = buildFold(
            paper: paper,
            request: FoldRequest(
                line: foldLine,
                moving: .positive
            ),
            nextFaceID: { FaceID(rawValue: 2) }
        )
        guard case let .success(animation) = result else {
            Issue.record("Expected the centered A4 fold to build successfully.")
            throw RenderFixtureError.foldRejected
        }
        return RenderFrame(paper: paper, animation: FoldAnimation(
            paperID: animation.paperID,
            progress: progress,
            line: animation.line,
            moving: animation.moving,
            stationaryFaces: animation.stationaryFaces,
            movingFaces: animation.movingFaces,
            foldedLayer: animation.foldedLayer
        ))
    }

    private func flippingA4Frame(progress: Double) throws -> RenderFrame {
        let paper = try Paper.rectangle(
            id: PaperID(rawValue: 1),
            faceID: FaceID(rawValue: 1),
            style: .white,
            center: .zero,
            width: 210,
            height: 297
        )
        let line = try Line2D(point: .zero, direction: Point2D(x: 0, y: 1))
        return RenderFrame(paper: paper, animation: FoldAnimation(
            paperID: paper.id,
            progress: progress,
            line: line,
            moving: .positive,
            stationaryFaces: [],
            movingFaces: paper.faces,
            foldedLayer: 1
        ))
    }

    private func committedFlipFrame() throws -> RenderFrame {
        let paper = try Paper.rectangle(
            id: PaperID(rawValue: 1),
            faceID: FaceID(rawValue: 1),
            style: .white,
            center: .zero,
            width: 210,
            height: 297
        )
        return RenderFrame(paper: commitFlip(paper))
    }

    private func pixel(in image: UIImage, at point: CGPoint) throws -> [UInt8] {
        guard let cgImage = image.cgImage else { throw RenderFixtureError.missingImage }
        let scale = image.scale
        let x = min(max(Int((point.x * scale).rounded()), 0), cgImage.width - 1)
        let y = min(max(Int((point.y * scale).rounded()), 0), cgImage.height - 1)
        var bytes = [UInt8](repeating: 0, count: 4)
        guard
            let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
            let context = CGContext(
                data: &bytes,
                width: 1,
                height: 1,
                bitsPerComponent: 8,
                bytesPerRow: 4,
                space: colorSpace,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            ),
            let cropped = cgImage.cropping(to: CGRect(x: x, y: y, width: 1, height: 1))
        else { throw RenderFixtureError.missingImage }
        context.draw(cropped, in: CGRect(x: 0, y: 0, width: 1, height: 1))
        return bytes
    }
}

private enum RenderFixtureError: Error {
    case foldRejected
    case missingImage
}
