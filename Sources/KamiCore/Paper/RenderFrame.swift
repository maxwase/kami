import Foundation

public struct PaperTransform: Equatable, Sendable {
    public let center: Point2D
    public let rotation: Double
    public let scale: Double

    public init(center: Point2D, rotation: Double, scale: Double) {
        self.center = center
        self.rotation = rotation
        self.scale = scale
    }
}

public struct RenderFold: Equatable, Sendable {
    public let progress: Double
    public let hinge: Line2D
    public let moving: FoldSide
    public let stationaryFaces: [Face]
    public let movingFaces: [Face]
    public let foldedLayer: Int

    public init(animation: FoldAnimation) {
        progress = animation.progress
        hinge = animation.line
        moving = animation.moving
        stationaryFaces = animation.stationaryFaces
        movingFaces = animation.movingFaces
        foldedLayer = animation.foldedLayer
    }
}

public struct RenderFrame: Equatable, Sendable {
    public let paperID: PaperID
    public let faces: [Face]
    public let style: PaperStyle
    public let transform: PaperTransform
    public let fold: RenderFold?
    public let foldProgress: Double
    public let hinge: Line2D?
    public let outlineEnabled: Bool

    public init(paper: Paper, animation: FoldAnimation? = nil, outlineEnabled: Bool = true) {
        paperID = paper.id
        faces = paper.faces
        style = paper.style
        transform = PaperTransform(center: paper.center, rotation: paper.rotation, scale: paper.scale)
        fold = animation.map(RenderFold.init)
        foldProgress = animation?.progress ?? 1
        hinge = animation?.line
        self.outlineEnabled = outlineEnabled
    }
}
