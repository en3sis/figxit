import AppKit
import Carbon

enum Caret {
    static let sourceID = "dev.figxit.inputmethod.caret"
    static let inputBundleID = "dev.figxit.inputmethod.caret"
    static let request = Notification.Name("dev.figxit.caret.request")
    static let reply = Notification.Name("dev.figxit.caret.reply")
    static let apps: Set<String> = ["dev.zed.Zed", "dev.zed.Zed-Preview"]

    static var bundled: URL {
        Bundle.main.bundleURL.appendingPathComponent("Contents/Library/Input Methods/FigxitInput.app")
    }

    static var installed: URL {
        URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Input Methods/FigxitInput.app")
    }

    static var flag: String {
        (Install.stoppedFlag as NSString).deletingLastPathComponent + "/zed-input"
    }

    static var wanted: Bool {
        FileManager.default.fileExists(atPath: flag)
    }

    static func handles(_ terminal: Terminal) -> Bool {
        wanted && apps.contains(terminal.bundleId ?? "")
    }

    static func sources() -> [TISInputSource] {
        let filter = [kTISPropertyInputSourceID as String: sourceID] as CFDictionary
        return (TISCreateInputSourceList(filter, true)?.takeRetainedValue() as? [TISInputSource]) ?? []
    }

    static func turnOn(_ done: @escaping (String?) -> Void) {
        guard FileManager.default.fileExists(atPath: bundled.path) else {
            return done("This build of Figxit has no input method.")
        }
        let manager = FileManager.default
        try? manager.removeItem(at: installed)
        do {
            try manager.createDirectory(at: installed.deletingLastPathComponent(), withIntermediateDirectories: true)
            try manager.createSymbolicLink(at: installed, withDestinationURL: bundled)
        } catch {
            return done(error.localizedDescription)
        }
        guard TISRegisterInputSource(installed as CFURL) == noErr, let source = sources().first else {
            return done("macOS did not accept the input method.")
        }
        TISEnableInputSource(source)
        finish(attempts: 10) { ok in
            if ok { manager.createFile(atPath: flag, contents: nil) }
            done(ok ? nil : "macOS did not turn on the input method.")
        }
    }

    private static func finish(attempts: Int, _ done: @escaping (Bool) -> Void) {
        guard attempts > 0, let executable = Bundle.main.executableURL else { return done(false) }
        let process = Process()
        process.executableURL = executable
        process.arguments = ["select-input"]
        process.terminationHandler = { process in
            DispatchQueue.main.async {
                if process.terminationStatus == 0 { return done(true) }
                DispatchQueue.main.asyncAfter(deadline: .now() + 1) { finish(attempts: attempts - 1, done) }
            }
        }
        do { try process.run() } catch { done(false) }
    }

    static func select() -> Bool {
        guard let source = sources().first else { return false }
        guard property(source, kTISPropertyInputSourceIsEnabled) else {
            TISEnableInputSource(source)
            return false
        }
        return property(source, kTISPropertyInputSourceIsSelected) || TISSelectInputSource(source) == noErr
    }

    private static func property(_ source: TISInputSource, _ key: CFString) -> Bool {
        guard let raw = TISGetInputSourceProperty(source, key) else { return false }
        return CFBooleanGetValue(Unmanaged<CFBoolean>.fromOpaque(raw).takeUnretainedValue())
    }

    static func refresh() {
        guard wanted, FileManager.default.fileExists(atPath: bundled.path),
              (try? FileManager.default.destinationOfSymbolicLink(atPath: installed.path)) != bundled.path
        else { return }
        try? FileManager.default.removeItem(at: installed)
        guard (try? FileManager.default.createSymbolicLink(at: installed, withDestinationURL: bundled)) != nil else { return }
        TISRegisterInputSource(installed as CFURL)
    }

    static func turnOff() {
        for source in sources() {
            TISDeselectInputSource(source)
            TISDisableInputSource(source)
        }
        try? FileManager.default.removeItem(at: installed)
        try? FileManager.default.removeItem(atPath: flag)
        for app in NSRunningApplication.runningApplications(withBundleIdentifier: inputBundleID) {
            app.terminate()
        }
    }

    static func placement(grid: Grid, caret: Int, rect: CGRect) -> Placement {
        let scale = Geometry.screen(containing: rect)?.backingScaleFactor ?? 2
        let cellW = Geometry.cellPoints(px: grid.cellPxW, scale: scale, estimate: rect.height * 0.45)
        let x = rect.minX - CGFloat(caret) * cellW
        return Placement(
            source: "ime",
            surface: Rect(rect),
            cellW: Double(cellW),
            cellH: Double(rect.height),
            x: Double(x),
            yTop: Double(rect.minY),
            yBelow: Double(rect.maxY)
        )
    }
}

final class CaretClient {
    private var next = 0
    private var waiting: (id: Int, apps: Set<String>, done: (CGRect?) -> Void, timer: Timer)?

    init() {
        DistributedNotificationCenter.default().addObserver(self, selector: #selector(received(_:)), name: Caret.reply, object: nil)
    }

    func ask(_ done: @escaping (CGRect?) -> Void) {
        waiting?.timer.invalidate()
        next += 1
        let id = next
        let timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: false) { [weak self] _ in self?.finish(id, nil) }
        waiting = (id, Caret.apps, done, timer)
        DistributedNotificationCenter.default().postNotificationName(Caret.request, object: nil, userInfo: ["id": id], deliverImmediately: true)
    }

    @objc private func received(_ note: Notification) {
        guard let info = note.userInfo, let id = info["id"] as? Int, let waiting = waiting, waiting.id == id,
              let bundle = info["bundle"] as? String, waiting.apps.contains(bundle),
              let x = info["x"] as? Double, let y = info["y"] as? Double,
              let w = info["w"] as? Double, let h = info["h"] as? Double, h > 0
        else { return }
        let top = Geometry.primaryHeight() - CGFloat(y) - CGFloat(h)
        finish(id, CGRect(x: x, y: top, width: max(w, 1), height: h))
    }

    private func finish(_ id: Int, _ rect: CGRect?) {
        guard let waiting = waiting, waiting.id == id else { return }
        waiting.timer.invalidate()
        self.waiting = nil
        waiting.done(rect)
    }
}
