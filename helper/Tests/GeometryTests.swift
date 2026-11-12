import XCTest
@testable import figxit_helper

final class GeometryTests: XCTestCase {
    private let window = CGRect(x: 100, y: 80, width: 987, height: 777)

    private func grid(_ json: String) -> Grid {
        try! JSONDecoder().decode(Grid.self, from: Data(json.utf8))
    }

    private func fit(_ json: String, base: CGRect? = nil, focused: Bool = false) -> (placement: Placement?, split: Bool) {
        Geometry.fit(grid: grid(json), base: base ?? window, focused: focused, scale: 1, physical: false)
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

    func testTerminalAppScrollbackIsClippedToTheScrollArea() throws {
        let textArea = CGRect(x: 55, y: -90410.623046875, width: 740, height: 91006.623046875)
        let scrollArea = CGRect(x: 55, y: 148, width: 740, height: 448)
        let surface = try XCTUnwrap(Geometry.clip(textArea, to: [scrollArea]))
        XCTAssertEqual(surface, scrollArea)
        let result = fit(#"{"cols":80,"rows":24,"col":10,"row":23,"padX":0,"padY":0,"pane":true}"#, base: surface, focused: true)
        XCTAssertEqual(result.placement!.yTop, 148 + 23 * 448 / 24, accuracy: 0.001)
        XCTAssertEqual(result.placement?.yBelow, 596)
    }

    func testShortTerminalAppWindowFallsBackToTheWindow() {
        let textArea = CGRect(x: 55, y: -90410, width: 740, height: 91006)
        XCTAssertNil(Geometry.clip(textArea, to: [CGRect(x: 55, y: 506, width: 740, height: 90)]))
    }

    func testClipKeepsASurfaceInsideItsAncestors() {
        let pane = CGRect(x: 594, y: 141, width: 476, height: 715)
        XCTAssertEqual(Geometry.clip(pane, to: [CGRect(x: 594, y: 141, width: 491, height: 715), window]), pane)
    }

    func testClipIgnoresAncestorsThatDoNotOverlap() {
        let frame = CGRect(x: 0, y: 0, width: 500, height: 400)
        XCTAssertEqual(Geometry.clip(frame, to: [CGRect(x: 2000, y: 0, width: 300, height: 300)]), frame)
    }
}
