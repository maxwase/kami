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

    @Test("An invalid self-intersecting polygon reports triangulation failure")
    func selfIntersectingFaceFailsExplicitly() throws {
        let outer = (0..<5).map { index in
            let angle = Double(index) / 5 * 2 * Double.pi - Double.pi / 2
            return Point2D(x: cos(angle) * 130, y: sin(angle) * 130)
        }
        let vertices = [outer[0], outer[2], outer[4], outer[1], outer[3]]
        let invalidFrame = try frame(vertices: vertices)

        #expect(throws: RenderFrameRendererError.triangulationFailed) {
            _ = try RenderFrameRenderer().render(
                frame: invalidFrame,
                in: CGSize(width: 390, height: 844)
            )
        }
    }

    private func frame(vertices: [Point2D]) throws -> RenderFrame {
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
        return RenderFrame(paper: paper)
    }
}
