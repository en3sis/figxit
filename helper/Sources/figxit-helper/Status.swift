import AppKit
import ServiceManagement
import Sparkle

enum Shell: String, CaseIterable {
    case zsh, bash, fish

    private static var versions: [String: String] = [:]

    static var loginPath: String {
        if let entry = getpwuid(getuid()), let shell = entry.pointee.pw_shell { return String(cString: shell) }
        return ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh"
    }

    static var login: Shell {
        Shell(rawValue: (loginPath as NSString).lastPathComponent) ?? .zsh
    }

    static var found: [Shell] { allCases.filter { $0.path != nil } }

    var icon: String {
        switch self {
        case .zsh: return "brand:zsh"
        case .bash: return "brand:gnubash"
        case .fish: return "brand:fishshell"
        }
    }

    var tint: String {
        switch self {
        case .zsh: return "F15A24"
        case .bash: return "4EAA25"
        case .fish: return "34C534"
        }
    }

    var candidates: [String] {
        let login = Shell.login == self ? [Shell.loginPath] : []
        var seen = Set<String>()
        return (login + Checks.searchPaths.map { $0 + "/" + rawValue } + ["/bin/" + rawValue]).filter {
            FileManager.default.isExecutableFile(atPath: $0)
                && seen.insert(URL(fileURLWithPath: $0).resolvingSymlinksInPath().path).inserted
        }
    }

    private func meetsMinimum(_ path: String) -> Bool {
        guard let minimum = minimum, let major = Int(Shell.version(at: path).prefix(while: { $0 != "." })) else { return true }
        return major >= minimum
    }

    var path: String? {
        let all = candidates
        if Shell.login == self, all.first == Shell.loginPath { return Shell.loginPath }
        return all.first(where: meetsMinimum) ?? all.first
    }

    var newer: String? {
        guard let path = path, tooOld else { return nil }
        return candidates.first { $0 != path && meetsMinimum($0) }
    }

    var loginFix: String? {
        guard let newer = newer else { return nil }
        let listed = ((try? String(contentsOfFile: "/etc/shells", encoding: .utf8)) ?? "")
            .split(separator: "\n").contains { $0.trimmingCharacters(in: .whitespaces) == newer }
        return (listed ? "" : "echo \(newer) | sudo tee -a /etc/shells && ") + "chsh -s \(newer)"
    }

    static func version(at path: String) -> String {
        if let hit = versions[path] { return hit }
        var found = ""
        let process = Process()
        let pipe = Pipe()
        process.executableURL = URL(fileURLWithPath: path)
        process.arguments = ["--version"]
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        if (try? process.run()) != nil {
            let text = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
            process.waitUntilExit()
            if let range = text.range(of: #"\d+\.\d+(\.\d+)?"#, options: .regularExpression) { found = String(text[range]) }
        }
        versions[path] = found
        return found
    }

    static func forgetVersions() { versions = [:] }

    var version: String { path.map(Shell.version) ?? "" }

    var minimum: Int? {
        switch self {
        case .zsh: return nil
        case .bash: return 5
        case .fish: return 4
        }
    }

    var tooOld: Bool { path.map { !meetsMinimum($0) } ?? false }

    private func exists(_ name: String) -> Bool {
        FileManager.default.fileExists(atPath: NSHomeDirectory() + "/" + name)
    }

    private func text(_ name: String) -> String {
        (try? String(contentsOfFile: NSHomeDirectory() + "/" + name, encoding: .utf8)) ?? ""
    }

    var files: [String] {
        switch self {
        case .zsh: return [".zshrc"]
        case .bash: return [".bashrc", ".bash_profile", ".bash_login", ".profile"]
        case .fish: return [".config/fish/conf.d/figxit.fish", ".config/fish/config.fish"]
        }
    }

    var target: String {
        switch self {
        case .zsh: return ".zshrc"
        case .fish: return ".config/fish/conf.d/figxit.fish"
        case .bash:
            guard let login = [".bash_profile", ".bash_login", ".profile"].first(where: exists) else { return ".bash_profile" }
            return text(login).contains(".bashrc") ? ".bashrc" : login
        }
    }

    var loadedFrom: String? {
        files.first { text($0).lowercased().contains("figxit") }
    }

    var line: String {
        let cli = Install.cliURL?.path ?? "/Applications/Figxit.app/Contents/MacOS/figxit-engine"
        switch self {
        case .zsh, .bash: return "eval \"$('\(cli)' init \(rawValue))\""
        case .fish: return "status is-interactive; and '\(cli)' init fish | source"
        }
    }
}

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

    static var stoppedFlag: String {
        (AppDelegate.socketPath as NSString).deletingLastPathComponent + "/stopped"
    }

    static var enterInsertsFlag: String {
        (stoppedFlag as NSString).deletingLastPathComponent + "/enter-inserts"
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
    enum Level { case ok, bad, off }
    let icon: String
    let tint: String
    let title: String
    let detail: String
    let status: String
    let level: Level
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

    static var ready: Bool { Shell.found.contains { $0.loadedFrom != nil && !$0.tooOld } }

    static func all() -> [Check] {
        let running = Install.engineRunning
        let shells = Install.shellCount
        let tmux = find("tmux") != nil
        let history = FileManager.default.fileExists(atPath: NSHomeDirectory() + "/.local/share/atuin/history.db")
        return [
            Check(icon: "sf:bolt.fill", tint: "3A3A3C", title: "Engine",
                  detail: running ? "Makes the rows of the popup." : "Select Resume Suggestions in the menu.",
                  status: running ? "Running" : "Stopped", level: running ? .ok : .bad),
            Check(icon: "sf:terminal.fill", tint: "3A3A3C", title: "Open terminals",
                  detail: shells > 0 ? "Terminals that have Figxit now." : "Open a new terminal, or run exec \(Shell.login.rawValue) in an open one.",
                  status: shells > 0 ? "\(shells) connected" : "None", level: shells > 0 ? .ok : .bad),
            Check(icon: "brand:tmux", tint: "1BB91F", title: "tmux",
                  detail: "Optional. Without it, a split of the terminal app gets no popup.",
                  status: tmux ? "Found" : "Not found", level: tmux ? .ok : .off),
            Check(icon: "sf:clock.arrow.circlepath", tint: "8E8E93", title: "Atuin history",
                  detail: "Optional. Ranks the rows by your history.",
                  status: history ? "Found" : "Not found", level: history ? .ok : .off),
        ]
    }
}

final class CardView: NSView {
    override func draw(_ dirtyRect: NSRect) {
        let path = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: 10, yRadius: 10)
        NSColor.controlBackgroundColor.setFill()
        path.fill()
        NSColor.separatorColor.setStroke()
        path.lineWidth = 1
        path.stroke()
    }
}

final class TileView: NSView {
    static let side: CGFloat = 28
    private let glyph: NSImage?
    private let tint: NSColor

    init(icon: String, tint: String) {
        self.glyph = IconStore.glyph(icon)
        self.tint = IconStore.color(hex: tint)
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        widthAnchor.constraint(equalToConstant: Self.side).isActive = true
        heightAnchor.constraint(equalToConstant: Self.side).isActive = true
    }

    required init?(coder: NSCoder) { nil }

    override func draw(_ dirtyRect: NSRect) {
        tint.setFill()
        NSBezierPath(roundedRect: bounds, xRadius: 7, yRadius: 7).fill()
        guard let glyph = glyph else { return }
        let ink: NSColor = IconStore.luminance(tint) > 0.72 ? NSColor.black.withAlphaComponent(0.85) : .white
        let box: CGFloat = 16
        let scale = min(box / max(glyph.size.width, 1), box / max(glyph.size.height, 1))
        let size = NSSize(width: glyph.size.width * scale, height: glyph.size.height * scale)
        let image = NSImage(size: size, flipped: false) { rect in
            glyph.draw(in: rect, from: .zero, operation: .sourceOver, fraction: 1)
            ink.set()
            rect.fill(using: .sourceIn)
            return true
        }
        image.draw(in: NSRect(x: bounds.midX - size.width / 2, y: bounds.midY - size.height / 2, width: size.width, height: size.height))
    }
}

enum Panel {
    static let width: CGFloat = 640
    static let cardWidth: CGFloat = width - 48
    static let rowWidth: CGFloat = cardWidth - 28
    static let rowHeight: CGFloat = 48

    static func state(_ text: String, _ level: Check.Level) -> NSTextField {
        let color: NSColor
        switch level {
        case .ok: color = .systemGreen
        case .bad: color = .systemRed
        case .off: color = .tertiaryLabelColor
        }
        let value = NSMutableAttributedString(string: "\u{25CF} ", attributes: [.foregroundColor: color, .font: NSFont.systemFont(ofSize: 9)])
        value.append(NSAttributedString(string: text, attributes: [
            .foregroundColor: level == .off ? NSColor.secondaryLabelColor : NSColor.labelColor,
            .font: NSFont.systemFont(ofSize: 12, weight: .medium),
        ]))
        let label = NSTextField(labelWithAttributedString: value)
        label.setContentCompressionResistancePriority(.required, for: .horizontal)
        return label
    }

    static func row(icon: String, tint: String, title: String, tag: String?, detail: String, trailing: [NSView]) -> NSView {
        let name = NSTextField(labelWithString: title)
        name.font = .systemFont(ofSize: 13, weight: .semibold)
        let heading = NSStackView(views: [name])
        heading.spacing = 6
        heading.alignment = .firstBaseline
        if let tag = tag {
            let label = NSTextField(labelWithString: tag)
            label.font = .systemFont(ofSize: 11)
            label.textColor = .tertiaryLabelColor
            heading.addArrangedSubview(label)
        }
        let body = NSTextField(labelWithString: detail)
        body.textColor = .secondaryLabelColor
        body.font = .systemFont(ofSize: 12)
        body.lineBreakMode = .byTruncatingMiddle
        body.toolTip = detail
        body.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        let text = NSStackView(views: [heading, body])
        text.orientation = .vertical
        text.alignment = .leading
        text.spacing = 1
        let side = NSStackView(views: trailing)
        side.spacing = 8
        side.setContentHuggingPriority(.required, for: .horizontal)
        let tile = TileView(icon: icon, tint: tint)
        let line = NSView()
        for view in [tile, text, side] as [NSView] {
            view.translatesAutoresizingMaskIntoConstraints = false
            line.addSubview(view)
        }
        line.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            line.widthAnchor.constraint(equalToConstant: Self.rowWidth),
            line.heightAnchor.constraint(equalToConstant: Self.rowHeight),
            tile.leadingAnchor.constraint(equalTo: line.leadingAnchor),
            tile.centerYAnchor.constraint(equalTo: line.centerYAnchor),
            text.leadingAnchor.constraint(equalTo: tile.trailingAnchor, constant: 12),
            text.centerYAnchor.constraint(equalTo: line.centerYAnchor),
            side.trailingAnchor.constraint(equalTo: line.trailingAnchor, constant: -2),
            side.centerYAnchor.constraint(equalTo: line.centerYAnchor),
            text.trailingAnchor.constraint(lessThanOrEqualTo: side.leadingAnchor, constant: -12),
        ])
        return line
    }

    static func fill(_ stack: NSStackView, _ views: [NSView]) {
        stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        for (index, view) in views.enumerated() {
            if index > 0 {
                let line = NSBox()
                line.boxType = .separator
                line.translatesAutoresizingMaskIntoConstraints = false
                line.widthAnchor.constraint(equalToConstant: Self.rowWidth).isActive = true
                stack.addArrangedSubview(line)
            }
            stack.addArrangedSubview(view)
        }
    }

    static func card(_ title: String, _ stack: NSStackView) -> NSView {
        let label = NSTextField(labelWithString: title)
        label.font = .systemFont(ofSize: 12, weight: .medium)
        label.textColor = .secondaryLabelColor
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 0
        stack.translatesAutoresizingMaskIntoConstraints = false
        let box = CardView()
        box.translatesAutoresizingMaskIntoConstraints = false
        box.addSubview(stack)
        NSLayoutConstraint.activate([
            box.widthAnchor.constraint(equalToConstant: Self.cardWidth),
            stack.leadingAnchor.constraint(equalTo: box.leadingAnchor, constant: 14),
            stack.topAnchor.constraint(equalTo: box.topAnchor, constant: 4),
            stack.bottomAnchor.constraint(equalTo: box.bottomAnchor, constant: -4),
        ])
        let group = NSStackView(views: [label, box])
        group.orientation = .vertical
        group.alignment = .leading
        group.spacing = 6
        return group
    }
}

final class SetupWindow: NSObject {
    private var window: NSWindow?
    private let summary = NSTextField(labelWithString: "")
    private let shellRows = NSStackView()
    private let checkRows = NSStackView()
    private let status = NSTextField(labelWithString: "")
    private var timer: Timer?
    private var shownState = ""

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

    func render(to outPath: String, dark: Bool) -> Bool {
        if window == nil { build() }
        reload()
        guard let window = window, let view = window.contentView else { return false }
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        view.layoutSubtreeIfNeeded()
        window.setContentSize(view.fittingSize)
        view.layoutSubtreeIfNeeded()
        window.displayIfNeeded()
        guard let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return false }
        view.cacheDisplay(in: view.bounds, to: rep)
        guard let png = rep.representation(using: .png, properties: [:]) else { return false }
        return FileManager.default.createFile(atPath: outPath, contents: png)
    }

    private func row(_ check: Check) -> NSView {
        Panel.row(icon: check.icon, tint: check.tint, title: check.title, tag: nil, detail: check.detail,
            trailing: [Panel.state(check.status, check.level)])
    }

    private func row(_ shell: Shell) -> NSView {
        let version = shell.version.isEmpty ? shell.rawValue : shell.version
        let tag = shell == Shell.login ? "login shell" : nil
        if shell.tooOld {
            let place = "\(version) at \(shell.path ?? "")."
            let needs = "Figxit needs \(shell.rawValue) \(shell.minimum ?? 0) or later."
            var detail = "\(place) \(needs)"
            var trailing: [NSView] = [Panel.state("Too old", .bad)]
            if let newer = shell.newer {
                detail = "\(version) at \(shell.path ?? ""), \(Shell.version(at: newer)) at \(newer)."
                let fix = NSButton(title: "Copy command", target: self, action: #selector(copyLoginFix(_:)))
                fix.tag = Shell.allCases.firstIndex(of: shell) ?? 0
                fix.bezelStyle = .rounded
                fix.toolTip = "Copies the command that makes \(newer) your login shell"
                trailing.append(fix)
            } else if shell == Shell.login {
                detail += " Run brew install \(shell.rawValue)."
            }
            return Panel.row(icon: shell.icon, tint: shell.tint, title: shell.rawValue, tag: tag, detail: detail, trailing: trailing)
        }
        if let file = shell.loadedFrom {
            return Panel.row(icon: shell.icon, tint: shell.tint, title: shell.rawValue, tag: tag,
                       detail: "\(version) at \(shell.path ?? ""). Loaded from ~/\(file).", trailing: [Panel.state("Set up", .ok)])
        }
        let index = Shell.allCases.firstIndex(of: shell) ?? 0
        let copy = NSButton(title: "Copy Line", target: self, action: #selector(copyLine(_:)))
        let add = NSButton(title: "Set Up", target: self, action: #selector(addLine(_:)))
        for button in [copy, add] {
            button.tag = index
            button.bezelStyle = .rounded
        }
        add.toolTip = "Adds one line to ~/\(shell.target)"
        copy.toolTip = "Copies the line, to add it yourself"
        return Panel.row(icon: shell.icon, tint: shell.tint, title: shell.rawValue, tag: tag,
                   detail: "\(version) at \(shell.path ?? "").", trailing: [Panel.state("Not set up", .off), copy, add])
    }

    private func reload() {
        let shells = Shell.found
        let checks = Checks.all()
        let key = (shells.map { "\($0)|\($0.loadedFrom ?? "")|\($0.path ?? "")|\($0.newer ?? "")" } + checks.map { "\($0.status)|\($0.detail)" })
            .joined(separator: "\n")
        guard key != shownState else { return }
        shownState = key
        Panel.fill(shellRows, shells.map(row))
        Panel.fill(checkRows, checks.map(row))
        let on = shells.filter { $0.loadedFrom != nil && !$0.tooOld }.map(\.rawValue)
        summary.stringValue = on.isEmpty
            ? "Set up a shell to start."
            : "Set up for \(ListFormatter.localizedString(byJoining: on)). It works in tmux and without tmux."
    }

    private func build() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: Panel.width, height: 480),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.title = "Figxit Setup"
        window.isReleasedWhenClosed = false

        let icon = NSImageView(image: NSApp.applicationIconImage)
        icon.translatesAutoresizingMaskIntoConstraints = false
        let title = NSTextField(labelWithString: "Figxit Setup")
        title.font = .systemFont(ofSize: 17, weight: .semibold)
        summary.textColor = .secondaryLabelColor
        summary.font = .systemFont(ofSize: 12)
        let words = NSStackView(views: [title, summary])
        words.orientation = .vertical
        words.alignment = .leading
        words.spacing = 2
        let header = NSStackView(views: [icon, words])
        header.spacing = 12

        let again = NSButton(title: "Check Again", target: self, action: #selector(checkAgain))
        let reloadShell = NSButton(title: "Copy exec \(Shell.login.rawValue)", target: self, action: #selector(copyReload))
        reloadShell.toolTip = "A change applies to new terminals. Run this command in an open terminal to load Figxit there."
        status.textColor = .secondaryLabelColor
        status.font = .systemFont(ofSize: 12)
        status.lineBreakMode = .byTruncatingTail
        status.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        let actions = NSStackView(views: [again, reloadShell, status])
        actions.spacing = 10

        let stack = NSStackView(views: [header, Panel.card("Shells on this Mac", shellRows), Panel.card("Status", checkRows), actions])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 16
        stack.edgeInsets = NSEdgeInsets(top: 20, left: 24, bottom: 20, right: 24)
        stack.translatesAutoresizingMaskIntoConstraints = false
        let content = NSView()
        content.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            stack.topAnchor.constraint(equalTo: content.topAnchor),
            stack.bottomAnchor.constraint(equalTo: content.bottomAnchor),
            content.widthAnchor.constraint(equalToConstant: Panel.width),
            actions.widthAnchor.constraint(lessThanOrEqualToConstant: Panel.cardWidth),
            icon.widthAnchor.constraint(equalToConstant: 40),
            icon.heightAnchor.constraint(equalToConstant: 40),
        ])
        window.contentView = content
        self.window = window
    }

    @objc private func copyReload() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString("exec \(Shell.login.rawValue)", forType: .string)
        status.stringValue = "Copied. Paste it in each open terminal."
    }

    @objc private func checkAgain() {
        Shell.forgetVersions()
        shownState = ""
        reload()
        status.stringValue = Checks.ready ? "Figxit is ready." : "No shell is set up."
    }

    @objc private func copyLoginFix(_ sender: NSButton) {
        guard let fix = Shell.allCases[sender.tag].loginFix else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(fix, forType: .string)
        status.stringValue = "Copied. Run it in a terminal, open a new terminal, then check again."
    }

    @objc private func copyLine(_ sender: NSButton) {
        let shell = Shell.allCases[sender.tag]
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(shell.line, forType: .string)
        status.stringValue = "Copied the line for \(shell.rawValue). Add it to ~/\(shell.target)."
    }

    @objc private func addLine(_ sender: NSButton) {
        let shell = Shell.allCases[sender.tag]
        let name = shell.target
        let path = NSHomeDirectory() + "/" + name
        if let found = shell.loadedFrom {
            status.stringValue = "~/\(found) already mentions figxit. Edit it by hand."
            return
        }
        let current = (try? String(contentsOfFile: path, encoding: .utf8)) ?? ""
        let addition = (current.isEmpty || current.hasSuffix("\n") ? "" : "\n") + (current.isEmpty ? "" : "\n") + "# Figxit\n" + shell.line + "\n"
        do {
            try FileManager.default.createDirectory(atPath: (path as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
            try (current + addition).write(toFile: path, atomically: true, encoding: .utf8)
            reload()
            status.stringValue = "Added to ~/\(name). Open a new terminal."
        } catch {
            status.stringValue = "Could not write ~/\(name): \(error.localizedDescription)"
        }
    }
}

final class StatusController: NSObject, NSMenuDelegate {
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    private let engine: EngineSupervisor?
    private let setup = SetupWindow()
    private let aboutWindow = AboutWindow()
    private let doctorWindow = DoctorWindow()
    private let settingsWindow = SettingsWindow()
    private let stateItem = NSMenuItem(title: "", action: nil, keyEquivalent: "")
    private let pauseItem = NSMenuItem(title: "", action: #selector(togglePause), keyEquivalent: "")
    private let restartItem = NSMenuItem(title: "Restart Engine", action: #selector(restart), keyEquivalent: "")
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
        menu.addItem(NSMenuItem(title: "Settings…", action: #selector(settings), keyEquivalent: ","))
        if let updater = updater {
            let check = NSMenuItem(
                title: "Check for Updates…",
                action: #selector(SPUStandardUpdaterController.checkForUpdates(_:)),
                keyEquivalent: ""
            )
            check.target = updater
            menu.addItem(check)
        }
        menu.addItem(NSMenuItem(title: "What's New…", action: #selector(whatsNew), keyEquivalent: ""))
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
        doctorWindow.show()
    }

    @objc private func settings() {
        settingsWindow.updater = updater?.updater
        settingsWindow.show()
    }

    @objc private func whatsNew() {
        guard let url = URL(string: "https://github.com/en3sis/figxit/releases") else { return }
        NSWorkspace.shared.open(url)
    }

    @objc private func about() {
        aboutWindow.show()
    }

    @objc private func quit() {
        Install.markStopped(true)
        NSApp.terminate(nil)
    }
}
