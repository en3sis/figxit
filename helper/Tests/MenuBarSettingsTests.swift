import XCTest
@testable import figxit_helper

final class MenuBarSettingsTests: XCTestCase {
    func testIconDefaultsToVisibleAndRemembersBothChoices() {
        let defaults = UserDefaults.standard
        let previous = defaults.object(forKey: "showMenuBarIcon")
        defer {
            if let previous = previous { defaults.set(previous, forKey: "showMenuBarIcon") }
            else { defaults.removeObject(forKey: "showMenuBarIcon") }
        }
        defaults.removeObject(forKey: "showMenuBarIcon")
        XCTAssertTrue(Install.showMenuBarIcon)
        Install.showMenuBarIcon = false
        XCTAssertFalse(Install.showMenuBarIcon)
        Install.showMenuBarIcon = true
        XCTAssertTrue(Install.showMenuBarIcon)
    }
}
