enum AppSheet: String, Equatable, Identifiable, Sendable {
    case info
    case settings

    var id: Self { self }
}
