import XCTest
@testable import figxit_helper

final class GeometryTests: XCTestCase {
    private let window = CGRect(x: 100, y: 80, width: 987, height: 777)
    private let textArea = CGRect(x: 0, y: -245, width: 580, height: 689)
    private let scrollArea = CGRect(x: 0, y: 91, width: 597, height: 353)

    private func grid(_ json: String) -> Grid {
        try! JSONDecoder().decode(Grid.self, from: Data(json.utf8))
    }

    private func fit(_ json: String, base: CGRect? = nil, focused: Bool = false) -> (placement: Placement?, split: Bool) {
        Geometry.fit(grid: grid(json), base: base ?? window, focused: focused, scale: 1, physical: false)
    }

    private func surface(_ frame: CGRect, in parent: CGRect?, role: String? = "AXScrollArea") -> CGRect? {
        Geometry.visibleSurface(frame, parentRole: role, parentFrame: parent)
    }

    func testShellThatFillsTheWindowIsPlaced() {
        let result = fit(#"{"cols":120,"rows":35,"col":6,"row":2,"cellPxW":8,"cellPxH":21,"pane":true}"#)
        XCTAssertFalse(result.split)
        XCTAssertEqual(result.placement?.x, 148)
        XCTAssertEqual(result.placement?.yTop, 80 + 42 + 42)
    }

    func testHalfWidthPaneWithoutAccessibilityIsASplit() {
        let result = fit(#"{"cols":58,"rows":33,"col":6,"row":0,"cellPxW":8,"cellPxH":21,"pane":true}"#)
        XCTAssertNil(result.placement)
        XCTAssertTrue(result.split)
    }

    func testTmuxInHalfTheWindowIsASplit() {
        let result = fit(#"{"cols":58,"rows":33,"col":6,"row":0,"cellPxW":8,"cellPxH":21}"#)
        XCTAssertNil(result.placement)
        XCTAssertTrue(result.split)
    }

    func testFocusedPaneIsPlacedInsideThePane() {
        let pane = CGRect(x: 594, y: 141, width: 476, height: 715)
        let result = fit(#"{"cols":58,"rows":33,"col":6,"row":1,"cellPxW":8,"cellPxH":21,"pane":true}"#, base: pane, focused: true)
        XCTAssertEqual(result.placement?.source, "ax")
        XCTAssertEqual(result.placement?.x, 594 + 48)
        XCTAssertEqual(result.placement?.yTop, 141 + 21)
    }

    func testEditorTerminalWithoutCellSizeUsesTheSurface() {
        let screen = CGRect(x: 455, y: 525, width: 1256, height: 425)
        let result = fit(#"{"cols":149,"rows":25,"col":8,"row":3,"pane":true}"#, base: screen, focused: true)
        XCTAssertEqual(result.placement?.cellH, 17)
        XCTAssertEqual(result.placement!.x, 455 + 8 * 1256 / 149, accuracy: 0.001)
        XCTAssertEqual(result.placement?.yTop, 525 + 51)
    }

    func testCellSizeInPixelsOnARetinaScreenStillFits() {
        let result = Geometry.fit(
            grid: grid(#"{"cols":120,"rows":35,"col":0,"row":0,"cellPxW":16,"cellPxH":42,"pane":true}"#),
            base: window, focused: false, scale: 2, physical: false
        )
        XCTAssertFalse(result.split)
        XCTAssertEqual(result.placement?.cellW, 8)
    }

    func testTerminalAppTextAreaIsClippedToItsScrollArea() {
        XCTAssertEqual(surface(textArea, in: scrollArea), CGRect(x: 0, y: 91, width: 580, height: 353))
        let large = CGRect(x: 0, y: -1148, width: 2540, height: 2593)
        XCTAssertEqual(surface(large, in: CGRect(x: 0, y: 98, width: 2557, height: 1333)), CGRect(x: 0, y: 98, width: 2540, height: 1333))
    }

    func testTerminalAppRowsAfterClearCountFromTheTopOfTheScrollArea() throws {
        let base = try XCTUnwrap(surface(textArea, in: scrollArea))
        for row in [0, 12, 23] {
            let json = #"{"cols":80,"rows":24,"col":2,"row":\#(row),"padX":0,"padY":0,"pane":true,"cellPxW":\#(580.0 / 80),"cellPxH":\#(353.0 / 24)}"#
            let placement = try XCTUnwrap(Geometry.fit(grid: grid(json), base: base, focused: true, scale: 2, physical: false).placement)
            XCTAssertEqual(placement.x, 14.5)
            XCTAssertEqual(placement.yTop, 91 + Double(row) * 353 / 24, accuracy: 0.001)
        }
    }

    func testOnlyAScrollAreaParentClipsTheSurface() {
        for role in ["AXGroup", "AXSplitGroup", "AXWindow", "?", nil] {
            XCTAssertEqual(surface(textArea, in: scrollArea, role: role), textArea)
        }
    }

    func testSurfaceWithoutAParentFrameIsUnchanged() {
        XCTAssertEqual(surface(window, in: nil), window)
    }

    func testSurfaceInsideItsScrollAreaIsUnchanged() {
        let pane = CGRect(x: 594, y: 141, width: 476, height: 715)
        XCTAssertEqual(surface(pane, in: CGRect(x: 594, y: 141, width: 491, height: 715)), pane)
        XCTAssertEqual(surface(pane, in: CGRect(x: 0, y: 25, width: 1920, height: 1055)), pane)
    }

    func testShortTerminalAppWindowDoesNotFallBackToTheWholeDocument() {
        XCTAssertNil(surface(textArea, in: CGRect(x: 0, y: 356.65, width: 597, height: 87.35)))
    }

    func testSurfaceThatMissesItsScrollAreaIsSkipped() {
        XCTAssertNil(surface(textArea, in: CGRect(x: 1000, y: 91, width: 597, height: 353)))
        XCTAssertNil(surface(textArea, in: CGRect(x: 0, y: 444, width: 597, height: 353)))
        XCTAssertNil(surface(textArea, in: CGRect(x: 575, y: 439, width: 597, height: 353)))
    }

    func testSurfaceOf100PointsOrLessIsSkipped() {
        XCTAssertNil(surface(CGRect(x: 0, y: 0, width: 100, height: 689), in: nil))
        XCTAssertNil(surface(CGRect(x: 0, y: 0, width: 580, height: 100), in: nil))
        XCTAssertNil(surface(textArea, in: CGRect(x: 480, y: 91, width: 597, height: 353)))
        XCTAssertNil(surface(textArea, in: CGRect(x: 0, y: 344, width: 597, height: 353)))
        XCTAssertEqual(surface(textArea, in: CGRect(x: 479, y: 91, width: 597, height: 353)), CGRect(x: 479, y: 91, width: 101, height: 353))
        XCTAssertEqual(surface(textArea, in: CGRect(x: 0, y: 343, width: 597, height: 353)), CGRect(x: 0, y: 343, width: 580, height: 101))
    }
}
