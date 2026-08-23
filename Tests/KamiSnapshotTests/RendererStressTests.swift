import KamiCore
@testable import KamiApp
import Foundation
import Testing
import UIKit

@MainActor
struct RendererStressTests {
    @Test("A high-vertex face renders without Metal inline-byte limits")
    func highVertexFaceRenders() throws {
        let vertexCount = 40_001
        let vertices = (0..<vertexCount).map { index in
            let angle = Double(index) / Double(vertexCount) * 2 * Double.pi
            return Point2D(x: cos(angle) * 130, y: sin(angle) * 130)
        }
        let polygon = try Polygon(vertices: vertices)
        let paper = try Paper(
            id: PaperID(rawValue: 1),
            style: .white,
            center: .zero,
            rotation: 0,
            scale: 1,
            baseSize: .a4,
            faces: [Face(id: FaceID(rawValue: 1), polygon: polygon, visibleSide: .front, layer: 0)]
        )

        let rendered = try RenderFrameRenderer().render(
            frame: RenderFrame(paper: paper),
            in: CGSize(width: 390, height: 844)
        )

        #expect(rendered.processedFaceCount == 1)
    }

    @Test("A geometrically distinct high-vertex concave face renders completely")
    func concaveHighVertexFaceRenders() throws {
        let vertexCount = 257
        let vertices = (0..<vertexCount).map { index in
            let angle = Double(index) / Double(vertexCount) * 2 * Double.pi
            let radius = index.isMultiple(of: 2) ? 130.0 : 92.0
            return Point2D(x: cos(angle) * radius, y: sin(angle) * radius)
        }
        let frame = try frame(vertices: vertices)

        let rendered = try RenderFrameRenderer().render(
            frame: frame,
            in: CGSize(width: 390, height: 844)
        )

        #expect(rendered.processedFaceCount == 1)
    }

    @Test("An invalid face is diagnosed without dropping valid faces")
    func mixedFrameRendersValidFaceAndReportsInvalidFace() throws {
        let validPolygon = try Polygon(vertices: [
            Point2D(x: -140, y: -120), Point2D(x: -20, y: -120),
            Point2D(x: -20, y: 120), Point2D(x: -140, y: 120),
        ])
        let outer = (0..<5).map { index in
            let angle = Double(index) / 5 * 2 * Double.pi - Double.pi / 2
            return Point2D(x: 70 + cos(angle) * 65, y: sin(angle) * 65)
        }
        let invalidPolygon = try Polygon(vertices: [outer[0], outer[2], outer[4], outer[1], outer[3]])
        let validID = FaceID(rawValue: 1)
        let invalidID = FaceID(rawValue: 2)
        let mixedFrame = try frame(faces: [
            Face(id: validID, polygon: validPolygon, visibleSide: .front, layer: 0),
            Face(id: invalidID, polygon: invalidPolygon, visibleSide: .front, layer: 1),
        ])

        let rendered = try RenderFrameRenderer().render(
            frame: mixedFrame,
            in: CGSize(width: 390, height: 844)
        )

        #expect(rendered.processedFaceCount == 1)
        #expect(rendered.faceFailures.count == 1)
        #expect(rendered.faceFailures.first?.faceID == invalidID)
        #expect(rendered.faceFailures.first?.error == .triangulationFailed)
    }

    @Test("Fold-produced concave geometry renders without loss")
    func foldProducedConcaveGeometryRenders() throws {
        let concavePolygon = try Polygon(vertices: [
            Point2D(x: -120, y: -120), Point2D(x: 120, y: -120),
            Point2D(x: 120, y: -30), Point2D(x: 20, y: -30),
            Point2D(x: 20, y: 120), Point2D(x: -120, y: 120),
        ])
        let paper = try paper(faces: [
            Face(id: FaceID(rawValue: 1), polygon: concavePolygon, visibleSide: .front, layer: 0),
        ])
        let line = try Line2D(point: .zero, direction: Point2D(x: 0, y: 1))
        var nextID: UInt64 = 2
        let result = buildFold(
            paper: paper,
            request: FoldRequest(line: line, moving: .positive),
            nextFaceID: {
                defer { nextID += 1 }
                return FaceID(rawValue: nextID)
            }
        )
        guard case let .success(built) = result else {
            Issue.record("Expected the concave face fold to build successfully.")
            return
        }
        let animation = FoldAnimation(
            paperID: built.paperID,
            progress: 0.25,
            line: built.line,
            moving: built.moving,
            stationaryFaces: built.stationaryFaces,
            movingFaces: built.movingFaces,
            foldedLayer: built.foldedLayer
        )

        let rendered = try RenderFrameRenderer().render(
            frame: RenderFrame(paper: paper, animation: animation),
            in: CGSize(width: 390, height: 844)
        )

        #expect(rendered.processedFaceCount == built.stationaryFaces.count + built.movingFaces.count)
        #expect(rendered.faceFailures.isEmpty)
    }

    private func frame(vertices: [Point2D]) throws -> RenderFrame {
        let polygon = try Polygon(vertices: vertices)
        return RenderFrame(paper: try paper(faces: [
            Face(id: FaceID(rawValue: 1), polygon: polygon, visibleSide: .front, layer: 0),
        ]))
    }

    private func frame(faces: [Face]) throws -> RenderFrame {
        RenderFrame(paper: try paper(faces: faces))
    }

    private func paper(faces: [Face]) throws -> Paper {
        try Paper(
            id: PaperID(rawValue: 1),
            style: .white,
            center: .zero,
            rotation: 0,
            scale: 1,
            baseSize: .a4,
            faces: faces
        )
    }
}
