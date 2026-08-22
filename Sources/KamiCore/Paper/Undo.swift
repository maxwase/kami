public struct PaperSnapshot: Equatable, Sendable {
    public let center: Point2D
    public let rotation: Double
    public let scale: Double
    public let faces: [Face]

    public init(paper: Paper) {
        center = paper.center
        rotation = paper.rotation
        scale = paper.scale
        faces = paper.faces
    }
}

public func restoring(_ paper: Paper, snapshot: PaperSnapshot) -> Paper {
    Paper(
        uncheckedID: paper.id,
        style: paper.style,
        center: snapshot.center,
        rotation: snapshot.rotation,
        scale: snapshot.scale,
        baseSize: paper.baseSize,
        faces: snapshot.faces
    )
}

public func reset(_ paper: Paper, nextFaceID: () -> FaceID) -> Paper {
    let halfWidth = paper.baseSize.width / 2
    let halfHeight = paper.baseSize.height / 2
    let vertices = [
        Point2D(x: -halfWidth, y: -halfHeight), Point2D(x: halfWidth, y: -halfHeight),
        Point2D(x: halfWidth, y: halfHeight), Point2D(x: -halfWidth, y: halfHeight),
    ]
    guard let polygon = try? Polygon(vertices: vertices) else { return paper }
    let face = Face(id: nextFaceID(), polygon: polygon, visibleSide: .front, layer: 0)
    return Paper(
        uncheckedID: paper.id,
        style: paper.style,
        center: paper.center,
        rotation: 0,
        scale: 1,
        baseSize: paper.baseSize,
        faces: [face]
    )
}

public struct UndoHistory: Equatable, Sendable {
    public let capacity: Int
    public let snapshots: [PaperSnapshot]

    public init(capacity: Int = 20, snapshots: [PaperSnapshot] = []) {
        self.capacity = max(0, capacity)
        self.snapshots = Array(snapshots.suffix(max(0, capacity)))
    }

    public func recording(_ paper: Paper) -> Self {
        Self(capacity: capacity, snapshots: snapshots + [PaperSnapshot(paper: paper)])
    }

    public func undoing(from paper: Paper) -> (paper: Paper, history: Self)? {
        guard let snapshot = snapshots.last else { return nil }
        return (
            paper: restoring(paper, snapshot: snapshot),
            history: Self(capacity: capacity, snapshots: Array(snapshots.dropLast()))
        )
    }
}
