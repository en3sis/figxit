import XCTest
@testable import figxit_helper

final class ShellSetupTests: XCTestCase {
    func testAppendKeepsASymlinkAndWritesTheLinkedFile() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let real = dir.appendingPathComponent("dotfiles-zshrc").path
        let link = dir.appendingPathComponent(".zshrc").path
        try "orig\n".write(toFile: real, atomically: true, encoding: .utf8)
        try FileManager.default.createSymbolicLink(atPath: link, withDestinationPath: real)

        try SetupWindow.append("added\n", to: link)

        XCTAssertEqual(try FileManager.default.destinationOfSymbolicLink(atPath: link), real)
        XCTAssertEqual(try String(contentsOfFile: real, encoding: .utf8), "orig\nadded\n")
    }
}
