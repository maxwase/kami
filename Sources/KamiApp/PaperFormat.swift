enum PaperFormat: String, CaseIterable, Equatable, Identifiable, Sendable {
    case a4
    case square
    case custom

    var id: Self { self }
}
