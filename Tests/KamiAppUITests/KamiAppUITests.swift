import XCTest

final class KamiAppUITests: XCTestCase {
    func testInitialWorkspaceExposesPrimaryControls() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.buttons["Fold"].exists)
        XCTAssertTrue(app.buttons["Settings"].exists)
    }
}
