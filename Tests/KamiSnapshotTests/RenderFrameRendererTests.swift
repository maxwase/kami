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
            ("folding-a4-portrait", foldingA4Frame(), CGSize(width: 390, height: 844)),
            ("folding-a4-landscape", foldingA4Frame(), CGSize(width: 844, height: 390)),
            ("layered-stack-portrait", stackedFrame(faceCount: 3), CGSize(width: 390, height: 844)),
            ("layered-stack-landscape", stackedFrame(faceCount: 3), CGSize(width: 844, height: 390)),
            ("flipping-a4-portrait", flippingA4Frame(), CGSize(width: 390, height: 844)),
            ("flipping-a4-landscape", flippingA4Frame(), CGSize(width: 844, height: 390)),
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

    @Test(arguments: [1, 64, 256])
    func rendererProcessesEveryFace(faceCount: Int) throws {
        let rendered = try RenderFrameRenderer().render(
            frame: try stackedFrame(faceCount: faceCount),
            in: CGSize(width: 390, height: 844)
        )

        #expect(rendered.processedFaceCount == faceCount)
    }

    @Test("The renderer p95 stays within the 60 fps budget through 64 faces", arguments: [1, 64])
    func rendererMeetsSixtyFramesPerSecondThrough64Faces(faceCount: Int) throws {
        let renderer = try RenderFrameRenderer()
        let frame = try stackedFrame(faceCount: faceCount)
        let size = CGSize(width: 390, height: 844)
        let target = try renderer.makeRenderTarget(in: size)
        let clock = ContinuousClock()
        var samples: [Duration] = []
        for _ in 0..<2 {
            _ = try renderer.draw(frame: frame, in: size, to: target)
        }
        for _ in 0..<30 {
            let start = clock.now
            _ = try renderer.draw(frame: frame, in: size, to: target)
            samples.append(start.duration(to: clock.now))
        }
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
            label: "onscreen",
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

        #expect(
            sorted[index] < .nanoseconds(16_700_000),
            "\(faceCount)-face p95 was \(sorted[index]); the Metal performance gate is 16.7 ms."
        )
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

    private func foldingA4Frame() throws -> RenderFrame {
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
            progress: 0.5,
            line: animation.line,
            moving: animation.moving,
            stationaryFaces: animation.stationaryFaces,
            movingFaces: animation.movingFaces,
            foldedLayer: animation.foldedLayer
        ))
    }

    private func flippingA4Frame() throws -> RenderFrame {
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
}

private enum RenderFixtureError: Error {
    case foldRejected
}
