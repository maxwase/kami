enum AppKeyboardCommand: CaseIterable, Equatable, Sendable {
    case fold
    case flip
    case reset

    var shortcut: AppKeyboardShortcut {
        switch self {
        case .fold:
            AppKeyboardShortcut(key: "f", modifiers: [.command, .shift])
        case .flip:
            AppKeyboardShortcut(key: "l", modifiers: [.command, .shift])
        case .reset:
            AppKeyboardShortcut(key: "r", modifiers: [.command, .shift])
        }
    }
}
