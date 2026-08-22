import Foundation

public enum FoldSide: Equatable, Sendable { case positive, negative }

public struct FoldRequest: Equatable, Sendable {
    public let line: Line2D
    public let moving: FoldSide

    public init(line: Line2D, moving: FoldSide) {
        self.line = line
        self.moving = moving
    }
}

public enum FoldRejection: Error, Equatable, Sendable {
    case noIntersection
    case emptyMovingSide
    case emptyStationarySide
    case layerOverflow
}

public struct FoldAnimation: Equatable, Sendable {
    public let paperID: PaperID
    public let duration: Duration
    public let progress: Double
    public let line: Line2D
    public let moving: FoldSide
    public let stationaryFaces: [Face]
    public let movingFaces: [Face]
    public let foldedLayer: Int

    public init(
        paperID: PaperID,
        duration: Duration = .milliseconds(460),
        progress: Double = 0,
        line: Line2D,
        moving: FoldSide,
        stationaryFaces: [Face],
        movingFaces: [Face],
        foldedLayer: Int
    ) {
        self.paperID = paperID
        self.duration = duration
        self.progress = progress.isFinite ? min(max(progress, 0), 1) : 0
        self.line = line
        self.moving = moving
        self.stationaryFaces = stationaryFaces
        self.movingFaces = movingFaces
        self.foldedLayer = foldedLayer
    }
}

public func buildFold(
    paper: Paper,
    request: FoldRequest,
    nextFaceID: () -> FaceID
) -> Result<FoldAnimation, FoldRejection> {
    let (foldedLayer, layerOverflow) = (paper.faces.map(\.layer).max() ?? 0).addingReportingOverflow(1)
    guard layerOverflow == false, foldedLayer <= maximumSafePaperLayer else { return .failure(.layerOverflow) }
    var stationaryPieces: [(polygon: Polygon, source: Face)] = []
    var movingPieces: [(polygon: Polygon, source: Face)] = []

    for face in paper.faces {
        let positive = face.polygon.clipped(to: request.line, keeping: .positive)
        let negative = face.polygon.clipped(to: request.line, keeping: .negative)
        let movingPolygon = request.moving == .positive ? positive : negative
        let stationaryPolygon = request.moving == .positive ? negative : positive

        if stationaryPolygon.vertices.isEmpty == false {
            stationaryPieces.append((polygon: stationaryPolygon, source: face))
        }
        if movingPolygon.vertices.isEmpty == false {
            movingPieces.append((polygon: movingPolygon, source: face))
        }
    }

    guard stationaryPieces.isEmpty == false || movingPieces.isEmpty == false else { return .failure(.noIntersection) }
    guard movingPieces.isEmpty == false else { return .failure(.emptyMovingSide) }
    guard stationaryPieces.isEmpty == false else { return .failure(.emptyStationarySide) }

    let stationaryFaces = stationaryPieces.map { piece in
        Face(id: nextFaceID(), polygon: piece.polygon, visibleSide: piece.source.visibleSide, layer: piece.source.layer)
    }
    let movingFaces = movingPieces.map { piece in
        Face(id: nextFaceID(), polygon: piece.polygon, visibleSide: piece.source.visibleSide, layer: piece.source.layer)
    }

    return .success(FoldAnimation(
        paperID: paper.id,
        line: request.line,
        moving: request.moving,
        stationaryFaces: stationaryFaces,
        movingFaces: movingFaces,
        foldedLayer: foldedLayer
    ))
}

public func commitFold(_ paper: Paper, animation: FoldAnimation, nextFaceID: () -> FaceID) -> Paper {
    guard animation.paperID == paper.id,
          animation.stationaryFaces.isEmpty == false,
          animation.movingFaces.isEmpty == false,
          animation.foldedLayer >= 0,
          animation.foldedLayer <= maximumSafePaperLayer,
          animation.stationaryFaces.allSatisfy({ $0.layer >= 0 && $0.layer <= maximumSafePaperLayer }),
          animation.movingFaces.allSatisfy({ $0.layer >= 0 && $0.layer <= maximumSafePaperLayer }) else {
        return paper
    }
    let maxMovingLayer = animation.movingFaces.map(\.layer).max() ?? 0
    var reflectedPieces: [(polygon: Polygon, source: Face, layer: Int)] = []

    for face in animation.movingFaces {
        guard let polygon = reflected(face.polygon, across: animation.line) else { return paper }
        let invertedLayer = maxMovingLayer - face.layer
        let (layer, layerOverflow) = animation.foldedLayer.addingReportingOverflow(invertedLayer)
        guard layerOverflow == false, layer <= maximumSafePaperLayer else { return paper }
        reflectedPieces.append((polygon: polygon, source: face, layer: layer))
    }
    let reflectedFaces = reflectedPieces.map { piece in
        Face(id: nextFaceID(), polygon: piece.polygon, visibleSide: piece.source.visibleSide.toggled, layer: piece.layer)
    }
    let faces = animation.stationaryFaces + reflectedFaces

    return Paper(
        uncheckedID: paper.id,
        style: paper.style,
        center: paper.center,
        rotation: paper.rotation,
        scale: paper.scale,
        baseSize: paper.baseSize,
        faces: removingExactDuplicates(from: faces)
    )
}

private func reflected(_ polygon: Polygon, across line: Line2D) -> Polygon? {
    try? Polygon(vertices: polygon.vertices.map(line.reflected))
}

private func removingExactDuplicates(from faces: [Face]) -> [Face] {
    var uniqueFaces: [Face] = []
    var signatures: [FaceSignature] = []
    for face in faces {
        let signature = FaceSignature(face: face)
        guard signatures.contains(signature) == false else { continue }
        signatures.append(signature)
        uniqueFaces.append(face)
    }
    return uniqueFaces
}

private struct FaceSignature: Equatable {
    let visibleSide: PaperSide
    let layer: Int
    let vertices: [Point2D]

    init(face: Face) {
        visibleSide = face.visibleSide
        layer = face.layer
        vertices = canonicalVertices(for: face.polygon.vertices)
    }
}

private func canonicalVertices(for vertices: [Point2D]) -> [Point2D] {
    guard vertices.count > 1 else { return vertices }
    let counterclockwise = signedArea(of: vertices) < 0 ? Array(vertices.reversed()) : vertices
    guard let first = counterclockwise.indices.min(by: { lhs, rhs in
        let left = counterclockwise[lhs]
        let right = counterclockwise[rhs]
        return left.y == right.y ? left.x < right.x : left.y < right.y
    }) else { return counterclockwise }
    return Array(counterclockwise[first...]) + Array(counterclockwise[..<first])
}

private func signedArea(of vertices: [Point2D]) -> Double {
    guard vertices.count > 2 else { return 0 }
    return vertices.indices.reduce(into: 0) { area, index in
        let next = vertices[(index + 1) % vertices.count]
        area += vertices[index].x * next.y - next.x * vertices[index].y
    } / 2
}
