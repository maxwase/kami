public enum GeometryError: Error, Equatable, Sendable {
    case degenerateLine
    case degeneratePolygon
}

enum GeometryTolerance {
    static let distance = 0.000_001
    static let area = 0.000_001
}
