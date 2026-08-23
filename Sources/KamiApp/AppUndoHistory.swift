import KamiCore

struct AppPaperSnapshot: Equatable, Sendable {
    let paper: Paper
    let paperSettings: PaperSettingsSnapshot

    init(paper: Paper, paperSettings: PaperSettings) {
        self.paper = paper
        self.paperSettings = PaperSettingsSnapshot(settings: paperSettings)
    }
}

struct PaperSettingsSnapshot: Equatable, Sendable {
    let format: PaperFormat
    let customWidth: Double
    let customHeight: Double
    let frontColor: String
    let backColor: String
    let edgeColor: String

    init(settings: PaperSettings) {
        format = settings.format
        customWidth = settings.customWidth
        customHeight = settings.customHeight
        frontColor = settings.frontColor
        backColor = settings.backColor
        edgeColor = settings.edgeColor
    }

    func restoring(into current: PaperSettings) -> PaperSettings {
        var settings = current
        settings.format = format
        settings.customWidth = customWidth
        settings.customHeight = customHeight
        settings.frontColor = frontColor
        settings.backColor = backColor
        settings.edgeColor = edgeColor
        settings.validationError = nil
        return settings
    }
}

struct AppUndoHistory: Equatable, Sendable {
    let capacity: Int
    let snapshots: [AppPaperSnapshot]

    init(capacity: Int = 20, snapshots: [AppPaperSnapshot] = []) {
        self.capacity = max(0, capacity)
        self.snapshots = Array(snapshots.suffix(max(0, capacity)))
    }

    func recording(paper: Paper, paperSettings: PaperSettings) -> Self {
        Self(
            capacity: capacity,
            snapshots: snapshots + [AppPaperSnapshot(paper: paper, paperSettings: paperSettings)]
        )
    }

    func undoing() -> (snapshot: AppPaperSnapshot, history: Self)? {
        guard let snapshot = snapshots.last else { return nil }
        return (
            snapshot: snapshot,
            history: Self(capacity: capacity, snapshots: Array(snapshots.dropLast()))
        )
    }
}
