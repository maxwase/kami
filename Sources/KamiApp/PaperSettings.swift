import KamiCore

struct PaperSettings: Equatable, Sendable {
    var format: PaperFormat
    var customWidth: Double
    var customHeight: Double
    var frontColor: String
    var backColor: String
    var edgeColor: String
    var outlineEnabled: Bool
    var debugOverlayEnabled: Bool
    var validationError: SettingsValidationError?

    init(
        format: PaperFormat = .a4,
        customWidth: Double = 210,
        customHeight: Double = 297,
        frontColor: String = PaperStyle.white.frontColor,
        backColor: String = PaperStyle.white.backColor,
        edgeColor: String = PaperStyle.white.edgeColor,
        outlineEnabled: Bool = true,
        debugOverlayEnabled: Bool = false,
        validationError: SettingsValidationError? = nil
    ) {
        self.format = format
        self.customWidth = customWidth
        self.customHeight = customHeight
        self.frontColor = frontColor
        self.backColor = backColor
        self.edgeColor = edgeColor
        self.outlineEnabled = outlineEnabled
        self.debugOverlayEnabled = debugOverlayEnabled
        self.validationError = validationError
    }
}
