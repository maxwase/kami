import Foundation

public struct PaperID: RawRepresentable, Hashable, Sendable {
    public let rawValue: UInt64
    public init(rawValue: UInt64) { self.rawValue = rawValue }
}

public struct FaceID: RawRepresentable, Hashable, Sendable {
    public let rawValue: UInt64
    public init(rawValue: UInt64) { self.rawValue = rawValue }
}

public enum PaperSide: String, Equatable, Sendable {
    case front
    case back

    public var toggled: Self { self == .front ? .back : .front }
}

public struct PaperStyle: Equatable, Sendable {
    public let frontColor: String
    public let backColor: String
    public let edgeColor: String

    public init(frontColor: String, backColor: String, edgeColor: String) {
        self.frontColor = frontColor
        self.backColor = backColor
        self.edgeColor = edgeColor
    }

    public static let white = PaperStyle(frontColor: "#FFFFFF", backColor: "#F0F0F0", edgeColor: "#00000029")
}

public struct PaperAspectRatio: Equatable, Sendable {
    public let width: Double
    public let height: Double

    public init(width: Double, height: Double) throws {
        guard width.isFinite, height.isFinite, width > 0, height > 0 else {
            throw PaperValidationError.invalidDimensions
        }
        self.width = width
        self.height = height
    }

    private init(validWidth: Double, validHeight: Double) {
        width = validWidth
        height = validHeight
    }

    public var value: Double { width / height }
    public static let a4 = PaperAspectRatio(validWidth: 210, validHeight: 297)
    public static let square = PaperAspectRatio(validWidth: 1, validHeight: 1)
}

public struct Face: Equatable, Sendable {
    public let id: FaceID
    public let polygon: Polygon
    public let visibleSide: PaperSide
    public let layer: Int

    public init(id: FaceID, polygon: Polygon, visibleSide: PaperSide, layer: Int) {
        self.id = id
        self.polygon = polygon
        self.visibleSide = visibleSide
        self.layer = layer
    }
}

public struct Paper: Equatable, Sendable {
    public let id: PaperID
    public let style: PaperStyle
    public let center: Point2D
    public let rotation: Double
    public let scale: Double
    public let baseSize: PaperAspectRatio
    public let faces: [Face]

    public static func rectangle(id: PaperID, faceID: FaceID, style: PaperStyle, center: Point2D, width: Double, height: Double) throws -> Self {
        let size = try PaperAspectRatio(width: width, height: height)
        let halfWidth = width / 2
        let halfHeight = height / 2
        let face = Face(
            id: faceID,
            polygon: try Polygon(vertices: [
                Point2D(x: -halfWidth, y: -halfHeight), Point2D(x: halfWidth, y: -halfHeight),
                Point2D(x: halfWidth, y: halfHeight), Point2D(x: -halfWidth, y: halfHeight),
            ]),
            visibleSide: .front,
            layer: 0
        )
        return Self(id: id, style: style, center: center, rotation: 0, scale: 1, baseSize: size, faces: [face])
    }

    public func folding(_ request: FoldRequest) throws -> Self {
        let maxLayer = faces.map(\.layer).max() ?? 0
        var stationary: [Face] = []
        var moving: [Face] = []
        var nextID = faces.map(\.id.rawValue).max() ?? 0

        for face in faces {
            let positive = face.polygon.clipped(to: request.line, keeping: .positive)
            let negative = face.polygon.clipped(to: request.line, keeping: .negative)
            let movable = request.moving == .positive ? positive : negative
            let fixed = request.moving == .positive ? negative : positive
            if fixed.vertices.isEmpty == false {
                nextID += 1
                stationary.append(Face(id: FaceID(rawValue: nextID), polygon: fixed, visibleSide: face.visibleSide, layer: face.layer))
            }
            if movable.vertices.isEmpty == false {
                nextID += 1
                let reflected = try Polygon(vertices: movable.vertices.map(request.line.reflected))
                moving.append(Face(id: FaceID(rawValue: nextID), polygon: reflected, visibleSide: face.visibleSide.toggled, layer: maxLayer + 1))
            }
        }
        guard stationary.isEmpty == false, moving.isEmpty == false else { throw FoldRejection.noIntersection }
        return Self(id: id, style: style, center: center, rotation: rotation, scale: scale, baseSize: baseSize, faces: stationary + moving)
    }
}

public enum PaperValidationError: Error, Equatable, Sendable { case invalidDimensions }

public enum FoldSide: Equatable, Sendable { case positive, negative }

public struct FoldRequest: Sendable {
    public let line: Line2D
    public let moving: FoldSide
    public init(line: Line2D, moving: FoldSide) { self.line = line; self.moving = moving }
}

public enum FoldRejection: Error, Equatable, Sendable { case noIntersection }

public struct FoldAnimation: Equatable, Sendable {
    public let duration: Duration
    public let progress: Double
    public init(duration: Duration = .milliseconds(460), progress: Double = 0) {
        self.duration = duration
        self.progress = min(max(progress, 0), 1)
    }
}

public struct RenderFrame: Equatable, Sendable {
    public let paper: Paper
    public let fold: FoldAnimation?
    public init(paper: Paper, fold: FoldAnimation? = nil) { self.paper = paper; self.fold = fold }
}
