import Foundation

let maximumSafePaperLayer = (Int.max - 1) / 2

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

    public init(
        id: PaperID,
        style: PaperStyle,
        center: Point2D,
        rotation: Double,
        scale: Double,
        baseSize: PaperAspectRatio,
        faces: [Face]
    ) throws {
        guard center.isFinite, rotation.isFinite, scale.isFinite, scale > 0 else {
            throw PaperValidationError.invalidTransform
        }
        guard faces.allSatisfy({ $0.layer >= 0 && $0.layer <= maximumSafePaperLayer }) else {
            throw PaperValidationError.invalidLayer
        }
        self.init(
            uncheckedID: id,
            style: style,
            center: center,
            rotation: rotation,
            scale: scale,
            baseSize: baseSize,
            faces: faces
        )
    }

    public static func rectangle(
        id: PaperID,
        faceID: FaceID,
        style: PaperStyle,
        center: Point2D,
        width: Double,
        height: Double
    ) throws -> Self {
        let size = try PaperAspectRatio(width: width, height: height)
        let face = Face(
            id: faceID,
            polygon: try Polygon(vertices: [
                Point2D(x: -width / 2, y: -height / 2), Point2D(x: width / 2, y: -height / 2),
                Point2D(x: width / 2, y: height / 2), Point2D(x: -width / 2, y: height / 2),
            ]),
            visibleSide: .front,
            layer: 0
        )
        return try Self(id: id, style: style, center: center, rotation: 0, scale: 1, baseSize: size, faces: [face])
    }

    init(
        uncheckedID id: PaperID,
        style: PaperStyle,
        center: Point2D,
        rotation: Double,
        scale: Double,
        baseSize: PaperAspectRatio,
        faces: [Face]
    ) {
        self.id = id
        self.style = style
        self.center = center
        self.rotation = rotation
        self.scale = scale
        self.baseSize = baseSize
        self.faces = faces
    }
}

public enum PaperValidationError: Error, Equatable, Sendable {
    case invalidDimensions
    case invalidTransform
    case invalidLayer
}
