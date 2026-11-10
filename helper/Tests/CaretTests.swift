import XCTest
@testable import figxit_helper

final class CaretTests: XCTestCase {
    func testPopupStartsAtTheWordBeforeZedsCursor() {
        let grid = try! JSONDecoder().decode(Grid.self, from: Data(#"{"cols":135,"rows":29,"col":2,"row":28,"cellPxW":7,"cellPxH":15,"pane":true}"#.utf8))
        let cursor = CGRect(x: 1304, y: 1098.4, width: 1, height: 15.6)
        let placement = Caret.placement(grid: grid, caret: 5, rect: cursor)
        XCTAssertEqual(placement.x, 1269, accuracy: 0.01)
        XCTAssertEqual(placement.yTop, 1098.4, accuracy: 0.01)
        XCTAssertEqual(placement.yBelow, 1114, accuracy: 0.01)
    }
}
