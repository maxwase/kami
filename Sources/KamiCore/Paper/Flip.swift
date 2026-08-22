import Foundation

public func commitFlip(_ paper: Paper) -> Paper {
    guard let bounds = faceBounds(in: paper.faces) else { return paper }
    let center = Point2D(x: (bounds.minimumX + bounds.maximumX) / 2, y: (bounds.minimumY + bounds.maximumY) / 2)
    let normal = Point2D(x: -cos(paper.rotation), y: sin(paper.rotation))
    let maximumLayer = paper.faces.map(\.layer).max() ?? 0
    var faces: [Face] = []
    for face in paper.faces {
        guard let polygon = flipped(face.polygon, around: center, normal: normal) else { return paper }
        faces.append(Face(
            id: face.id,
            polygon: polygon,
            visibleSide: face.visibleSide.toggled,
            layer: maximumLayer - face.layer
        ))
    }
    return Paper(
        uncheckedID: paper.id,
        style: paper.style,
        center: paper.center,
        rotation: paper.rotation,
        scale: paper.scale,
        baseSize: paper.baseSize,
        faces: faces
    )
}

private struct FaceBounds {
    var minimumX: Double
    var maximumX: Double
    var minimumY: Double
    var maximumY: Double
}

private func faceBounds(in faces: [Face]) -> FaceBounds? {
    let vertices = faces.flatMap { $0.polygon.vertices }
    guard let first = vertices.first else { return nil }
    return vertices.dropFirst().reduce(FaceBounds(minimumX: first.x, maximumX: first.x, minimumY: first.y, maximumY: first.y)) { bounds, point in
        FaceBounds(
            minimumX: min(bounds.minimumX, point.x), maximumX: max(bounds.maximumX, point.x),
            minimumY: min(bounds.minimumY, point.y), maximumY: max(bounds.maximumY, point.y)
        )
    }
}

private func flipped(_ polygon: Polygon, around center: Point2D, normal: Point2D) -> Polygon? {
    try? Polygon(vertices: polygon.vertices.map { point in
        let offsetX = point.x - center.x
        let offsetY = point.y - center.y
        let dotProduct = offsetX * normal.x + offsetY * normal.y
        return Point2D(x: point.x - 2 * dotProduct * normal.x, y: point.y - 2 * dotProduct * normal.y)
    })
}
