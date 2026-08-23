struct AppKeyboardShortcut: Equatable, Hashable, Sendable {
    let key: Character
    let modifiers: Set<AppKeyboardModifier>
}

enum AppKeyboardModifier: Hashable, Sendable {
    case command
    case shift
}
