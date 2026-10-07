import AppKit
import ServiceManagement
import Sparkle

final class SettingsWindow: NSObject {
    var updater: SPUUpdater?
    private var window: NSWindow?
    private let keys = NSStackView()
    private let app = NSStackView()
    private let enter = NSSwitch()
    private let login = NSSwitch()
    private let updates = NSSwitch()

    func show() {
        if window == nil { build() }
        reload()
        NSApp.activate(ignoringOtherApps: true)
        window?.center()
        window?.makeKeyAndOrderFront(nil)
    }

    func render(to outPath: String) -> Bool {
        if window == nil { build() }
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
        enter.state = FileManager.default.fileExists(atPath: Install.enterInsertsFlag) ? .off : .on
        login.state = SMAppService.mainApp.status == .enabled ? .on : .off
        updates.state = updater?.automaticallyChecksForUpdates == true ? .on : .off
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

        for (toggle, action) in [(enter, #selector(toggleEnter)), (login, #selector(toggleLogin)), (updates, #selector(toggleUpdates))] {
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
        var rows = [
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

        let stack = NSStackView(views: [Panel.card("Keys", keys), Panel.card("App", app)])
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

    @objc private func toggleEnter() {
        let path = Install.enterInsertsFlag
        if enter.state == .on {
            try? FileManager.default.removeItem(atPath: path)
        } else {
            FileManager.default.createFile(atPath: path, contents: nil)
        }
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
