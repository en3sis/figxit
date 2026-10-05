import AppKit
import ServiceManagement
import Sparkle

enum Install {
    static var version: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev"
    }

    static var cliURL: URL? {
        Bundle.main.executableURL?.deletingLastPathComponent().appendingPathComponent("figxit-engine")
    }

    static var engineSocket: String {
        ProcessInfo.processInfo.environment["FIGXIT_SOCK"] ?? NSHomeDirectory() + "/.local/state/figxit/engine.sock"
    }

    static var shellLine: String {
        let path = cliURL?.path ?? "/Applications/Figxit.app/Contents/MacOS/figxit-engine"
        return "eval \"$('\(path)' init zsh)\""
    }

    static var stoppedFlag: String {
        (AppDelegate.socketPath as NSString).deletingLastPathComponent + "/stopped"
    }

    static var shellCount: Int {
        let path = (stoppedFlag as NSString).deletingLastPathComponent + "/shells"
        let text = (try? String(contentsOfFile: path, encoding: .utf8)) ?? ""
        return engineRunning ? Int(text.trimmingCharacters(in: .whitespacesAndNewlines)) ?? 0 : 0
    }

    static func markStopped(_ stopped: Bool) {
        if stopped {
            FileManager.default.createFile(atPath: stoppedFlag, contents: nil)
        } else {
            try? FileManager.default.removeItem(atPath: stoppedFlag)
        }
    }

    static var engineRunning: Bool {
        SocketServer(path: engineSocket) { _ in nil }.alreadyRunning()
    }

    static func statusIcon() -> NSImage {
        let image = NSImage(size: NSSize(width: 18, height: 18), flipped: false) { _ in
            let chevron = NSBezierPath()
            chevron.move(to: NSPoint(x: 2.6, y: 13.2))
            chevron.line(to: NSPoint(x: 6.8, y: 9))
            chevron.line(to: NSPoint(x: 2.6, y: 4.8))
            chevron.lineWidth = 2
            chevron.lineCapStyle = .round
            chevron.lineJoinStyle = .round
            NSColor.black.setStroke()
            chevron.stroke()
            let rows: [(y: CGFloat, width: CGFloat, alpha: CGFloat)] = [(12.1, 5, 0.5), (7.9, 7.4, 1), (3.7, 6, 0.5)]
            for row in rows {
                NSColor.black.withAlphaComponent(row.alpha).setFill()
                NSBezierPath(roundedRect: NSRect(x: 9.6, y: row.y, width: row.width, height: 2.2), xRadius: 1.1, yRadius: 1.1).fill()
            }
            return true
        }
        image.isTemplate = true
        return image
    }
}

struct Check {
    enum State { case ok, missing, optional }
    let state: State
    let title: String
    let detail: String
}

enum Checks {
    static let searchPaths = [
        "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin",
        NSHomeDirectory() + "/.local/bin", NSHomeDirectory() + "/.cargo/bin", NSHomeDirectory() + "/.atuin/bin",
        NSHomeDirectory() + "/.nix-profile/bin", "/run/current-system/sw/bin",
    ]

    static func find(_ tool: String) -> String? {
        searchPaths.map { $0 + "/" + tool }.first { FileManager.default.isExecutableFile(atPath: $0) }
    }

    static var shellLoaded: Bool {
        let rc = (try? String(contentsOfFile: NSHomeDirectory() + "/.zshrc", encoding: .utf8)) ?? ""
        return rc.lowercased().contains("figxit")
    }

    static var ready: Bool { shellLoaded && find("tmux") != nil }

    static func all() -> [Check] {
        let tmux = find("tmux")
        let history = NSHomeDirectory() + "/.local/share/atuin/history.db"
        let hasHistory = FileManager.default.fileExists(atPath: history)
        let shells = Install.shellCount
        return [
            Check(state: shellLoaded ? .ok : .missing, title: "Shell integration",
                  detail: shellLoaded ? "Found in ~/.zshrc." : "Not in ~/.zshrc yet. Add the line below."),
            Check(state: tmux != nil ? .ok : .missing, title: "tmux",
                  detail: tmux ?? "Not found. The popup works only inside tmux. Install it with: brew install tmux"),
            Check(state: hasHistory ? .ok : .optional, title: "Atuin history",
                  detail: hasHistory ? "Found. Rows are ranked by your history."
                      : "Not found. Optional. Without it, rows are not ranked by your history."),
            Check(state: Install.engineRunning ? .ok : .missing, title: "Engine",
                  detail: Install.engineRunning ? "Running." : "Not running. Select Resume Suggestions or Restart Engine in the menu."),
            Check(state: shells > 0 ? .ok : .missing, title: "Open terminals",
                  detail: shells > 0 ? "\(shells) connected."
                      : "None connected. A terminal that was open before this setup does not have Figxit yet. Run exec zsh in it, or open a new tmux pane."),
        ]
    }
}

final class SetupWindow: NSObject {
    private var window: NSWindow?
    private let rows = NSStackView()
    private let status = NSTextField(labelWithString: "")
    private let lineBox = NSStackView()
    private var timer: Timer?

    func show() {
        if window == nil { build() }
        status.stringValue = ""
        reload()
        NSApp.activate(ignoringOtherApps: true)
        window?.center()
        window?.makeKeyAndOrderFront(nil)
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] timer in
            guard let self = self, self.window?.isVisible == true else { return timer.invalidate() }
            self.reload()
        }
    }

    private func row(_ check: Check) -> NSView {
        let symbol: String
        let color: NSColor
        switch check.state {
        case .ok: (symbol, color) = ("checkmark.circle.fill", .systemGreen)
        case .missing: (symbol, color) = ("xmark.circle.fill", .systemRed)
        case .optional: (symbol, color) = ("minus.circle.fill", .systemGray)
        }
        let icon = NSImageView(image: NSImage(systemSymbolName: symbol, accessibilityDescription: nil) ?? NSImage())
        icon.contentTintColor = color
        icon.setContentHuggingPriority(.required, for: .horizontal)
        let title = NSTextField(labelWithString: check.title)
        title.font = .systemFont(ofSize: 13, weight: .semibold)
        let detail = NSTextField(wrappingLabelWithString: check.detail)
        detail.textColor = .secondaryLabelColor
        detail.font = .systemFont(ofSize: 12)
        detail.isSelectable = true
        detail.preferredMaxLayoutWidth = 430
        let text = NSStackView(views: [title, detail])
        text.orientation = .vertical
        text.alignment = .leading
        text.spacing = 2
        let line = NSStackView(views: [icon, text])
        line.alignment = .top
        line.spacing = 10
        return line
    }

    private func reload() {
        rows.arrangedSubviews.forEach { $0.removeFromSuperview() }
        Checks.all().forEach { rows.addArrangedSubview(row($0)) }
        lineBox.isHidden = Checks.shellLoaded
    }

    private func build() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 520, height: 420),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.title = "Figxit Setup"
        window.isReleasedWhenClosed = false

        let title = NSTextField(labelWithString: "Figxit Setup")
        title.font = .systemFont(ofSize: 17, weight: .semibold)
        rows.orientation = .vertical
        rows.alignment = .leading
        rows.spacing = 12

        let line = NSTextField(wrappingLabelWithString: Install.shellLine)
        line.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        line.isSelectable = true
        line.drawsBackground = true
        line.backgroundColor = .textBackgroundColor
        line.isBordered = true
        let copy = NSButton(title: "Copy Line", target: self, action: #selector(copyLine))
        let add = NSButton(title: "Add to ~/.zshrc", target: self, action: #selector(addLine))
        let buttons = NSStackView(views: [copy, add])
        buttons.spacing = 10
        lineBox.orientation = .vertical
        lineBox.alignment = .leading
        lineBox.spacing = 10
        lineBox.addArrangedSubview(line)
        lineBox.addArrangedSubview(buttons)

        let hint = NSTextField(wrappingLabelWithString:
            "After a change, open a new tmux pane, or run exec zsh in an open one.")
        hint.textColor = .secondaryLabelColor
        hint.font = .systemFont(ofSize: 12)
        let again = NSButton(title: "Check Again", target: self, action: #selector(checkAgain))
        let reloadShell = NSButton(title: "Copy exec zsh", target: self, action: #selector(copyReload))
        let actions = NSStackView(views: [again, reloadShell])
        actions.spacing = 10
        status.textColor = .secondaryLabelColor

        let stack = NSStackView(views: [title, rows, lineBox, hint, actions, status])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 14
        stack.edgeInsets = NSEdgeInsets(top: 22, left: 24, bottom: 20, right: 24)
        stack.translatesAutoresizingMaskIntoConstraints = false
        let content = NSView()
        content.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            stack.topAnchor.constraint(equalTo: content.topAnchor),
            stack.bottomAnchor.constraint(equalTo: content.bottomAnchor),
            line.widthAnchor.constraint(equalToConstant: 472),
            hint.widthAnchor.constraint(equalToConstant: 472),
        ])
        window.contentView = content
        self.window = window
    }

    @objc private func copyReload() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString("exec zsh", forType: .string)
        status.stringValue = "Copied. Paste it in each open terminal."
    }

    @objc private func checkAgain() {
        reload()
        status.stringValue = Checks.ready ? "Figxit is ready." : "Some parts are missing."
    }

    @objc private func copyLine() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(Install.shellLine, forType: .string)
        status.stringValue = "Copied."
    }

    @objc private func addLine() {
        let path = NSHomeDirectory() + "/.zshrc"
        let current = (try? String(contentsOfFile: path, encoding: .utf8)) ?? ""
        if current.lowercased().contains("figxit") {
            status.stringValue = "~/.zshrc already mentions figxit. Edit it by hand."
            return
        }
        let addition = (current.isEmpty || current.hasSuffix("\n") ? "" : "\n") + "\n# Figxit\n" + Install.shellLine + "\n"
        do {
            try (current + addition).write(toFile: path, atomically: true, encoding: .utf8)
            reload()
            status.stringValue = "Added. Open a new tmux pane, or run exec zsh."
        } catch {
            status.stringValue = "Could not write ~/.zshrc: \(error.localizedDescription)"
        }
    }
}

final class StatusController: NSObject, NSMenuDelegate {
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    private let engine: EngineSupervisor?
    private let setup = SetupWindow()
    private let stateItem = NSMenuItem(title: "", action: nil, keyEquivalent: "")
    private let pauseItem = NSMenuItem(title: "", action: #selector(togglePause), keyEquivalent: "")
    private let restartItem = NSMenuItem(title: "Restart Engine", action: #selector(restart), keyEquivalent: "")
    private let loginItem = NSMenuItem(title: "Launch at Login", action: #selector(toggleLogin), keyEquivalent: "")
    private let autoUpdateItem = NSMenuItem(title: "Check for Updates Automatically", action: #selector(toggleAutoUpdate), keyEquivalent: "")
    private var timer: Timer?
    private var updater: SPUStandardUpdaterController?

    init(engine: EngineSupervisor?) {
        self.engine = engine
        super.init()
        if engine != nil {
            updater = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: nil, userDriverDelegate: nil)
        }
        item.button?.image = Install.statusIcon()
        item.button?.toolTip = "Figxit"

        let menu = NSMenu()
        menu.delegate = self
        menu.autoenablesItems = false
        let header = NSMenuItem(title: "Figxit \(Install.version)\(engine == nil ? " (dev)" : "")", action: nil, keyEquivalent: "")
        header.isEnabled = false
        stateItem.isEnabled = false
        menu.addItem(header)
        menu.addItem(stateItem)
        menu.addItem(.separator())
        if engine != nil {
            menu.addItem(pauseItem)
            menu.addItem(restartItem)
            menu.addItem(.separator())
        }
        menu.addItem(NSMenuItem(title: "Set Up Shell…", action: #selector(openSetup), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Run Doctor…", action: #selector(doctor), keyEquivalent: ""))
        menu.addItem(.separator())
        menu.addItem(loginItem)
        if let updater = updater {
            let check = NSMenuItem(
                title: "Check for Updates…",
                action: #selector(SPUStandardUpdaterController.checkForUpdates(_:)),
                keyEquivalent: ""
            )
            check.target = updater
            menu.addItem(check)
            menu.addItem(autoUpdateItem)
        }
        menu.addItem(NSMenuItem(title: "About Figxit", action: #selector(about), keyEquivalent: ""))
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit Figxit", action: #selector(quit), keyEquivalent: "q"))
        for entry in menu.items where entry.action != nil && entry.target == nil { entry.target = self }
        item.menu = menu

        refresh()
        timer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in self?.refresh() }
    }

    func showSetup(onlyIfNeeded: Bool) {
        if onlyIfNeeded && Checks.ready { return }
        setup.show()
    }

    private func refresh() {
        let running = Install.engineRunning
        item.button?.appearsDisabled = !running
        let shells = Install.shellCount
        stateItem.title = running ? (shells > 0 ? "Running, \(shells) \(shells == 1 ? "terminal" : "terminals") connected" : "Running, no terminal connected") : (engine?.paused == true ? "Suggestions are paused" : "Engine is not running")
        pauseItem.title = engine?.paused == true ? "Resume Suggestions" : "Pause Suggestions"
        restartItem.isEnabled = engine?.paused == false
        loginItem.state = SMAppService.mainApp.status == .enabled ? .on : .off
        autoUpdateItem.state = updater?.updater.automaticallyChecksForUpdates == true ? .on : .off
    }

    func menuWillOpen(_ menu: NSMenu) {
        refresh()
    }

    @objc private func togglePause() {
        guard let engine = engine else { return }
        if engine.paused { engine.resume() } else { engine.stop() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [weak self] in self?.refresh() }
    }

    @objc private func restart() {
        engine?.restart()
    }

    @objc private func openSetup() {
        showSetup(onlyIfNeeded: false)
    }

    @objc private func doctor() {
        var report = "The figxit command was not found in the app."
        if let cli = Install.cliURL, FileManager.default.isExecutableFile(atPath: cli.path) {
            let process = Process()
            let pipe = Pipe()
            process.executableURL = cli
            process.arguments = ["doctor", "--app"]
            process.standardOutput = pipe
            process.standardError = pipe
            if (try? process.run()) != nil {
                let data = pipe.fileHandleForReading.readDataToEndOfFile()
                process.waitUntilExit()
                report = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? report
            }
        }
        let text = NSTextField(wrappingLabelWithString: report)
        text.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        text.isSelectable = true
        text.preferredMaxLayoutWidth = 560
        text.frame = NSRect(origin: .zero, size: text.sizeThatFits(NSSize(width: 560, height: 2000)))
        let alert = NSAlert()
        alert.messageText = "Figxit Doctor"
        alert.accessoryView = text
        NSApp.activate(ignoringOtherApps: true)
        alert.runModal()
    }

    @objc private func toggleAutoUpdate() {
        guard let updater = updater?.updater else { return }
        updater.automaticallyChecksForUpdates.toggle()
        refresh()
    }

    @objc private func toggleLogin() {
        do {
            if SMAppService.mainApp.status == .enabled {
                try SMAppService.mainApp.unregister()
            } else {
                try SMAppService.mainApp.register()
            }
        } catch {
            let alert = NSAlert()
            alert.messageText = "Launch at Login could not be changed"
            alert.informativeText = error.localizedDescription
            NSApp.activate(ignoringOtherApps: true)
            alert.runModal()
        }
        refresh()
    }

    @objc private func about() {
        NSApp.activate(ignoringOtherApps: true)
        NSApp.orderFrontStandardAboutPanel(nil)
    }

    @objc private func quit() {
        Install.markStopped(true)
        NSApp.terminate(nil)
    }
}
