import SwiftUI

extension AppKeyboardShortcut {
    var keyEquivalent: KeyEquivalent {
        KeyEquivalent(key)
    }

    var eventModifiers: EventModifiers {
        modifiers.reduce(into: EventModifiers()) { result, modifier in
            switch modifier {
            case .command:
                result.insert(.command)
            case .shift:
                result.insert(.shift)
            }
        }
    }
}
