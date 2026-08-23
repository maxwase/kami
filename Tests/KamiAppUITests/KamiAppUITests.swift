import XCTest

@MainActor
final class KamiAppUITests: XCTestCase {
    func testInitialWorkspaceExposesPrimaryControls() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.buttons["Fold"].exists)
        XCTAssertTrue(app.buttons["Flip"].exists)
        XCTAssertTrue(app.buttons["Reset"].exists)
        XCTAssertTrue(app.buttons["Undo"].exists)
        XCTAssertTrue(app.buttons["Settings"].exists)
        XCTAssertTrue(app.buttons["Information"].exists)
        XCTAssertTrue(app.otherElements["Paper canvas"].exists)
    }

    func testPrimaryActionsUpdateUndoAvailability() {
        let app = XCUIApplication()
        app.launch()

        let undo = app.buttons["Undo"]
        XCTAssertTrue(undo.exists)
        XCTAssertFalse(undo.isEnabled)

        app.buttons["Fold"].tap()
        wait(for: NSPredicate(format: "isEnabled == true"), on: app.buttons["Undo"], timeout: 2)

        app.buttons["Undo"].tap()
        wait(for: NSPredicate(format: "isEnabled == false"), on: app.buttons["Undo"], timeout: 2)

        app.buttons["Flip"].tap()
        wait(for: NSPredicate(format: "isEnabled == true"), on: app.buttons["Undo"], timeout: 2)

        app.buttons["Reset"].tap()
        XCTAssertTrue(app.buttons["Undo"].isEnabled)
    }

    func testSettingsAndInformationArePresented() {
        let app = XCUIApplication()
        app.launch()

        app.buttons["Settings"].tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 1))
        XCTAssertTrue(app.segmentedControls["Paper size"].exists)
        XCTAssertTrue(app.switches["Paper outline"].exists)
        app.buttons["Done"].tap()

        app.buttons["Information"].tap()
        XCTAssertTrue(app.navigationBars["About FoldFlow"].waitForExistence(timeout: 1))
        XCTAssertTrue(app.staticTexts["A calm, tactile workspace for exploring paper one fold at a time."].exists)
    }

    private func wait(for predicate: NSPredicate, on element: XCUIElement, timeout: TimeInterval) {
        let expectation = XCTNSPredicateExpectation(predicate: predicate, object: element)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: timeout), .completed)
    }
}
