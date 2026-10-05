import AppKit

final class EngineSupervisor {
    private let url: URL
    private var process: Process?
    private var failures = 0
    private var stopping = false
    var paused: Bool { stopping }

    init?() {
        guard ProcessInfo.processInfo.environment["FIGXIT_NO_ENGINE"] == nil,
              let directory = Bundle.main.executableURL?.deletingLastPathComponent()
        else { return nil }
        let url = directory.appendingPathComponent("figxit-engine")
        guard FileManager.default.isExecutableFile(atPath: url.path) else { return nil }
        self.url = url
    }

    func start() {
        let process = Process()
        process.executableURL = url
        process.arguments = ["daemon"]
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        let started = Date()
        process.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async { self?.exited(after: Date().timeIntervalSince(started)) }
        }
        do {
            try process.run()
            self.process = process
        } catch {
            exited(after: 0)
        }
    }

    private func exited(after seconds: TimeInterval) {
        process = nil
        guard !stopping else { return }
        failures = seconds < 5 ? failures + 1 : 0
        guard failures < 5 else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5 * pow(2, Double(failures))) { [weak self] in
            guard let self = self, !self.stopping else { return }
            self.start()
        }
    }

    func stop() {
        stopping = true
        process?.terminate()
    }

    func resume() {
        guard stopping else { return }
        stopping = false
        failures = 0
        start()
    }

    func restart() {
        guard !stopping else { return }
        failures = 0
        if let process = process { process.terminate() } else { start() }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private let engine = EngineSupervisor()
    private var signals: [DispatchSourceSignal] = []
    private var status: StatusController?
    private let popup = PopupController()
    private var shown: (pid: pid_t, window: Int?, frame: CGRect?, grid: Grid, items: [Item], selected: Int)?
    private var watcher: Timer?
    private var server: SocketServer?
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    static var socketPath: String {
        if let override = ProcessInfo.processInfo.environment["FIGXIT_HELPER_SOCK"] { return override }
        return NSHomeDirectory() + "/.local/state/figxit/helper.sock"
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let server = SocketServer(path: Self.socketPath) { [weak self] line in self?.handle(line) }
        if server.alreadyRunning() { exit(0) }
        guard server.start() else {
            FileHandle.standardError.write("figxit-helper: cannot listen on \(Self.socketPath)\n".data(using: .utf8)!)
            exit(1)
        }
        self.server = server
        if engine != nil { Install.markStopped(false) }
        engine?.start()
        if ProcessInfo.processInfo.environment["FIGXIT_HELPER_SOCK"] == nil {
            status = StatusController(engine: engine)
            if engine != nil {
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
                    self?.status?.showSetup(onlyIfNeeded: true)
                }
            }
        }
        for number in [SIGINT, SIGTERM] {
            signal(number, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: number, queue: .main)
            source.setEventHandler { NSApp.terminate(nil) }
            source.resume()
            signals.append(source)
        }
        NSWorkspace.shared.notificationCenter.addObserver(
            self,
            selector: #selector(appActivated(_:)),
            name: NSWorkspace.didActivateApplicationNotification,
            object: nil
        )
    }

    func applicationWillTerminate(_ notification: Notification) {
        engine?.stop()
        unlink(Self.socketPath)
    }

    private func watch() {
        guard watcher == nil else { return }
        watcher = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in self?.checkWindow() }
    }

    private func forget() {
        shown = nil
        watcher?.invalidate()
        watcher = nil
    }

    private func checkWindow() {
        guard let shown = shown else { return forget() }
        guard let terminal = Geometry.frontTerminal(), terminal.pid == shown.pid else { return }
        let current = Geometry.cgWindow(pid: shown.pid)
        if current?.id != shown.window {
            forget()
            popup.hide()
            server?.broadcast(Data(#"{"event":"hidden"}"#.utf8))
            return
        }
        if current?.frame != shown.frame, let placement = Geometry.placement(grid: shown.grid, terminal: terminal) {
            self.shown?.frame = current?.frame
            popup.show(items: shown.items, selected: shown.selected, placement: placement)
        }
    }

    @objc private func appActivated(_ note: Notification) {
        let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
        guard let shown = shown, let app = app, app.processIdentifier == shown.pid,
              let terminal = Geometry.frontTerminal(),
              let placement = Geometry.placement(grid: shown.grid, terminal: terminal)
        else { return popup.hide() }
        popup.show(items: shown.items, selected: shown.selected, placement: placement)
    }

    private func handle(_ line: Data) -> Data? {
        guard let request = try? decoder.decode(Request.self, from: line) else {
            return try? encoder.encode(StatusReply(ok: false, error: "bad request", placement: nil))
        }
        switch request.cmd {
        case "show":
            guard let grid = request.grid, let items = request.items else {
                return try? encoder.encode(StatusReply(ok: false, error: "show needs grid and items", placement: nil))
            }
            guard let terminal = Geometry.frontTerminal(),
                  let placement = Geometry.placement(grid: grid, terminal: terminal)
            else {
                forget()
                popup.hide()
                return try? encoder.encode(StatusReply(ok: false, error: "no terminal window", placement: nil))
            }
            let window = Geometry.cgWindow(pid: terminal.pid)
            shown = (terminal.pid, window?.id, window?.frame, grid, items, request.selected ?? 0)
            watch()
            popup.show(items: items, selected: request.selected ?? 0, placement: placement)
            return try? encoder.encode(StatusReply(ok: true, error: nil, placement: placement))
        case "hide":
            forget()
            popup.hide()
            return try? encoder.encode(StatusReply(ok: true, error: nil, placement: nil))
        case "probe":
            return try? encoder.encode(Geometry.probe(grid: request.grid))
        case "quit":
            Install.markStopped(true)
            popup.hide()
            DispatchQueue.main.async { NSApp.terminate(nil) }
            return try? encoder.encode(StatusReply(ok: true, error: nil, placement: nil))
        default:
            return try? encoder.encode(StatusReply(ok: false, error: "unknown cmd", placement: nil))
        }
    }
}

func snapshot(itemsPath: String, outPath: String, dark: Bool) -> Never {
    guard let data = FileManager.default.contents(atPath: itemsPath),
          let items = try? JSONDecoder().decode([Item].self, from: data)
    else { exit(2) }
    let view = ListView(frame: NSRect(origin: .zero, size: ListView.size(for: items)))
    view.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
    view.items = items
    view.selected = 0
    view.background = dark ? NSColor(white: 0.16, alpha: 1) : NSColor(white: 0.93, alpha: 1)
    guard let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: Int(view.bounds.width * 2), pixelsHigh: Int(view.bounds.height * 2),
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
    ) else { exit(3) }
    rep.size = view.bounds.size
    view.appearance?.performAsCurrentDrawingAppearance {
        view.cacheDisplay(in: view.bounds, to: rep)
    }
    guard let png = rep.representation(using: .png, properties: [:]) else { exit(4) }
    FileManager.default.createFile(atPath: outPath, contents: png)
    exit(0)
}

let app = NSApplication.shared
if CommandLine.arguments.count >= 4, CommandLine.arguments[1] == "snapshot" {
    snapshot(
        itemsPath: CommandLine.arguments[2],
        outPath: CommandLine.arguments[3],
        dark: CommandLine.arguments.count > 4 && CommandLine.arguments[4] == "dark"
    )
}
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
