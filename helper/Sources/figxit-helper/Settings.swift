import AppKit
import ApplicationServices
import ServiceManagement
import Sparkle

private struct Extra: Decodable {
    let name: String
    let title: String
    let state: String
    let bytes: Int
    let size: Int
    let icon: String
    let tint: String
}

final class SettingsWindow: NSObject {
    var updater: SPUUpdater?
    var onMenuBarVisibilityChanged: ((Bool) -> Void)?
    private var window: NSWindow?
    private let keys = NSStackView()
    private let extras = NSStackView()
    private var extrasCard: NSView?
    private var extraList: [Extra] = []
    private var downloading: Set<String> = []
    private var failures: [String: String] = [:]
    private let app = NSStackView()
    private let permissions = NSStackView()
    private var timer: Timer?
    private var access: Bool?
    private let enter = NSSwitch()
    private let compact = NSSwitch()
    private let look = NSStackView()
    private let theme = NSSegmentedControl(labels: PopupTheme.allCases.map(\.title), trackingMode: .selectOne, target: nil, action: nil)
    private let login = NSSwitch()
    private let updates = NSSwitch()
    private let menuBar = NSSwitch()
    private let zed = NSSwitch()
    private let experimental = NSStackView()

    func show() {
        if window == nil { build() }
        refreshExtras()
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

    func render(to outPath: String) -> Bool {
        if window == nil { build() }
        refreshExtras()
        reload()
        guard let window = window, let view = window.contentView else { return false }
        view.layoutSubtreeIfNeeded()
        window.setContentSize(view.fittingSize)
        view.layoutSubtreeIfNeeded()
        window.displayIfNeeded()
        guard let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return false }
        view.cacheDisplay(in: view.bounds, to: rep)
        guard let png = rep.representation(using: .png, properties: [:]) else { return false }
        return FileManager.default.createFile(atPath: outPath, contents: png)
    }

    private func reload() {
        menuBar.state = Install.showMenuBarIcon ? .on : .off
        zed.state = Caret.wanted ? .on : .off
        enter.state = FileManager.default.fileExists(atPath: Install.enterInsertsFlag) ? .off : .on
        compact.state = ListMetrics.compactEnabled ? .on : .off
        theme.selectedSegment = PopupTheme.allCases.firstIndex(of: PopupTheme.current) ?? 0
        login.state = SMAppService.mainApp.status == .enabled ? .on : .off
        updates.state = updater?.automaticallyChecksForUpdates == true ? .on : .off
        let trusted = AXIsProcessTrusted()
        guard trusted != access else { return }
        access = trusted
        var trailing: [NSView] = [Panel.state(trusted ? "Allowed" : "Not allowed", trusted ? .ok : Install.splitSeen ? .bad : .off)]
        if !trusted {
            let allow = NSButton(title: "Allow…", target: self, action: #selector(allowAccess))
            allow.bezelStyle = .rounded
            trailing.append(allow)
        }
        Panel.fill(permissions, [
            Panel.row(
                icon: "sf:rectangle.split.2x1.fill",
                tint: "0A84FF",
                title: "Accessibility",
                tag: nil,
                detail: trusted ? "On. The popup works in split panes and editor terminals." : Access.detail,
                trailing: trailing
            ),
        ])
    }

    @objc private func allowAccess() {
        Access.request()
    }

    private func build() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: Panel.width, height: 320),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.title = "Figxit Settings"
        window.isReleasedWhenClosed = false

        for (toggle, action) in [(enter, #selector(toggleEnter)), (compact, #selector(toggleCompact)), (login, #selector(toggleLogin)), (updates, #selector(toggleUpdates)), (menuBar, #selector(toggleMenuBar)), (zed, #selector(toggleZed))] {
            toggle.target = self
            toggle.action = action
        }

        Panel.fill(keys, [
            Panel.row(
                icon: "sf:return",
                tint: "3A3A3C",
                title: "Enter runs the highlighted row",
                tag: nil,
                detail: "When off, Enter inserts the row and a second Enter runs the line.",
                trailing: [enter]
            ),
        ])
        theme.target = self
        theme.action = #selector(changeTheme)
        Panel.fill(look, [
            Panel.row(
                icon: "sf:circle.lefthalf.filled",
                tint: "636366",
                title: "Popup theme",
                tag: nil,
                detail: "System follows your Mac's light or dark mode.",
                trailing: [theme]
            ),
            Panel.row(
                icon: "sf:rectangle.compress.vertical",
                tint: "FF9F0A",
                title: "Compact popup",
                tag: nil,
                detail: "Shorter rows and smaller text, so the popup covers less of the terminal.",
                trailing: [compact]
            ),
        ])
        var rows = [
            Panel.row(
                icon: "sf:menubar.rectangle",
                tint: "5E5CE6",
                title: "Show in menu bar",
                tag: nil,
                detail: "Run figxit open to show the menu bar icon again.",
                trailing: [menuBar]
            ),
            Panel.row(
                icon: "sf:power",
                tint: "5E5CE6",
                title: "Launch at login",
                tag: nil,
                detail: "Start Figxit when you log in to this Mac.",
                trailing: [login]
            ),
        ]
        if updater != nil {
            rows.append(Panel.row(
                icon: "sf:arrow.down.circle.fill",
                tint: "34C759",
                title: "Check for updates automatically",
                tag: nil,
                detail: "Figxit asks before it installs an update.",
                trailing: [updates]
            ))
        }
        Panel.fill(app, rows)

        Panel.fill(experimental, [
            Panel.row(
                icon: "sf:text.cursor",
                tint: "FF9F0A",
                title: "Zed terminal",
                tag: nil,
                detail: "Finds Zed's cursor with a hidden input method. Reopen Zed after.",
                trailing: [zed]
            ),
        ])

        let extrasCard = Panel.card("Extra completions", extras)
        self.extrasCard = extrasCard
        let stack = NSStackView(views: [Panel.card("Keys", keys), Panel.card("Appearance", look), extrasCard, Panel.card("Permissions", permissions), Panel.card("Experimental", experimental), Panel.card("App", app)])
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
        ])
        window.contentView = content
        self.window = window
    }

    private static func megabytes(_ bytes: Int) -> String {
        String(format: "%.1f MB", Double(bytes) / 1e6)
    }

    private static func runEngine(_ arguments: [String]) -> (ok: Bool, output: Data, error: String) {
        guard let cli = Install.cliURL, FileManager.default.isExecutableFile(atPath: cli.path) else {
            return (false, Data(), "Figxit's engine was not found")
        }
        let process = Process()
        let output = Pipe()
        let error = Pipe()
        process.executableURL = cli
        process.arguments = arguments
        process.standardOutput = output
        process.standardError = error
        guard (try? process.run()) != nil else { return (false, Data(), "Figxit's engine could not start") }
        let data = output.fileHandleForReading.readDataToEndOfFile()
        let message = String(data: error.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        process.waitUntilExit()
        return (process.terminationStatus == 0, data, message.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    private func refreshExtras() {
        let result = Self.runEngine(["extras", "--json"])
        extraList = (try? JSONDecoder().decode([Extra].self, from: result.output)) ?? []
        fillExtras()
    }

    private func fillExtras() {
        let rows = extraList.map { extra -> NSView in
            let busy = downloading.contains(extra.name)
            let detail: String
            if let failure = failures[extra.name] {
                detail = failure
            } else if busy {
                detail = "Downloading \(Self.megabytes(extra.bytes))…"
            } else if extra.state == "installed" {
                detail = "Installed. \(Self.megabytes(extra.size)) on disk."
            } else if extra.state == "outdated" {
                detail = "A new version is available. \(Self.megabytes(extra.bytes)) download."
            } else {
                detail = "\(Self.megabytes(extra.bytes)) download, \(Self.megabytes(extra.size)) on disk."
            }
            var trailing: [NSView] = []
            if busy {
                let spinner = NSProgressIndicator()
                spinner.style = .spinning
                spinner.controlSize = .small
                spinner.startAnimation(nil)
                trailing.append(spinner)
            } else {
                let installed = extra.state == "installed"
                let title = installed ? "Remove" : extra.state == "outdated" ? "Update" : "Download"
                let button = NSButton(title: title, target: self, action: #selector(changeExtra(_:)))
                button.bezelStyle = .rounded
                button.identifier = NSUserInterfaceItemIdentifier(extra.name)
                if installed {
                    button.hasDestructiveAction = true
                    button.attributedTitle = NSAttributedString(string: title, attributes: [
                        .foregroundColor: NSColor.systemRed,
                        .font: button.font ?? NSFont.systemFont(ofSize: NSFont.systemFontSize),
                    ])
                } else {
                    let symbol = extra.state == "outdated" ? "arrow.triangle.2.circlepath" : "icloud.and.arrow.down"
                    button.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)
                    button.imagePosition = .imageLeading
                }
                trailing.append(button)
            }
            return Panel.row(icon: extra.icon, tint: extra.tint, title: extra.title, tag: extra.name, detail: detail, trailing: trailing)
        }
        Panel.fill(extras, rows)
        extrasCard?.isHidden = rows.isEmpty
    }

    @objc private func changeExtra(_ sender: NSButton) {
        guard let name = sender.identifier?.rawValue, let extra = extraList.first(where: { $0.name == name }) else { return }
        let action = extra.state == "installed" ? "remove" : "add"
        failures[name] = nil
        if action == "add" { downloading.insert(name) }
        fillExtras()
        DispatchQueue.global(qos: .userInitiated).async {
            let result = Self.runEngine(["extras", action, name])
            DispatchQueue.main.async { [weak self] in
                guard let self = self else { return }
                self.downloading.remove(name)
                if !result.ok {
                    let message = result.error.hasPrefix("figxit: ") ? String(result.error.dropFirst(8)) : result.error
                    self.failures[name] = message.prefix(1).uppercased() + message.dropFirst()
                }
                self.refreshExtras()
            }
        }
    }

    @objc private func toggleEnter() {
        let path = Install.enterInsertsFlag
        if enter.state == .on {
            try? FileManager.default.removeItem(atPath: path)
        } else {
            FileManager.default.createFile(atPath: path, contents: nil)
        }
        reload()
    }

    @objc private func toggleZed() {
        guard zed.state == .on else {
            Caret.turnOff()
            return reload()
        }
        zed.isEnabled = false
        Caret.turnOn { [weak self] error in
            self?.zed.isEnabled = true
            if let error = error {
                Caret.turnOff()
                let alert = NSAlert()
                alert.messageText = "The Zed terminal option could not be turned on"
                alert.informativeText = error
                NSApp.activate(ignoringOtherApps: true)
                alert.runModal()
            }
            self?.reload()
        }
    }

    @objc private func toggleMenuBar() {
        Install.showMenuBarIcon = menuBar.state == .on
        onMenuBarVisibilityChanged?(Install.showMenuBarIcon)
    }

    @objc private func changeTheme() {
        let cases = PopupTheme.allCases
        if cases.indices.contains(theme.selectedSegment) { PopupTheme.current = cases[theme.selectedSegment] }
        reload()
    }

    @objc private func toggleCompact() {
        ListMetrics.compactEnabled = compact.state == .on
        reload()
    }

    @objc private func toggleUpdates() {
        updater?.automaticallyChecksForUpdates = updates.state == .on
        reload()
    }

    @objc private func toggleLogin() {
        do {
            if login.state == .on {
                try SMAppService.mainApp.register()
            } else {
                try SMAppService.mainApp.unregister()
            }
        } catch {
            let alert = NSAlert()
            alert.messageText = "Launch at Login could not be changed"
            alert.informativeText = error.localizedDescription
            NSApp.activate(ignoringOtherApps: true)
            alert.runModal()
        }
        reload()
    }
}
