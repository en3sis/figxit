import AppKit

struct DoctorRow: Decodable {
    let level: String
    let name: String
    let detail: String
}

final class DoctorWindow: NSObject {
    private static let icons: [String: (icon: String, tint: String)] = [
        "app bundle": ("sf:app.fill", "5E5CE6"),
        "popup helper": ("sf:macwindow", "3A3A3C"),
        "engine": ("sf:bolt.fill", "3A3A3C"),
        "completion specs": ("sf:list.bullet", "64748B"),
        "atuin history": ("sf:clock.arrow.circlepath", "8E8E93"),
        "shells connected": ("sf:terminal.fill", "3A3A3C"),
        "zsh": ("brand:zsh", "F15A24"),
        "bash": ("brand:gnubash", "4EAA25"),
        "fish": ("brand:fishshell", "34C534"),
        "tmux": ("brand:tmux", "1BB91F"),
    ]

    private var window: NSWindow?
    private let rows = NSStackView()
    private let summary = NSTextField(labelWithString: "")
    private let status = NSTextField(labelWithString: "")
    private var report = ""

    func show() {
        if window == nil { build() }
        status.stringValue = ""
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

    private func run(_ arguments: [String]) -> Data? {
        guard let cli = Install.cliURL, FileManager.default.isExecutableFile(atPath: cli.path) else { return nil }
        let process = Process()
        let pipe = Pipe()
        process.executableURL = cli
        process.arguments = arguments
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        guard (try? process.run()) != nil else { return nil }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        return data
    }

    private func reload() {
        let data = run(["doctor", "--app", "--json"]) ?? Data()
        let found = (try? JSONDecoder().decode([DoctorRow].self, from: data)) ?? []
        report = found.map { "\($0.level == "ok" ? "ok  " : "--  ") \($0.name.padding(toLength: 18, withPad: " ", startingAt: 0)) \($0.detail)" }
            .joined(separator: "\n")
        let views = found.map { item -> NSView in
            let look = Self.icons[item.name] ?? ("sf:questionmark", "8E8E93")
            let level: Check.Level = item.level == "ok" ? .ok : item.level == "off" ? .off : .bad
            let shell = Shell(rawValue: item.name) != nil
            let old = shell && item.detail.contains("too old")
            let word = old ? "Too old" : level == .ok ? (shell ? "Set up" : "OK") : level == .off ? (shell ? "Not set up" : "Not found") : "Problem"
            let title = look.icon.hasPrefix("brand:") ? item.name : item.name.prefix(1).uppercased() + item.name.dropFirst()
            return Panel.row(icon: look.icon, tint: look.tint, title: title,
                             tag: nil, detail: item.detail, trailing: [Panel.state(word, level)])
        }
        Panel.fill(rows, views)
        let problems = found.filter { $0.level == "bad" }.count
        summary.stringValue = found.isEmpty ? "The figxit command was not found in the app."
            : problems == 0 ? "No problem found." : "\(problems) \(problems == 1 ? "problem" : "problems") found."
    }

    private func build() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: Panel.width, height: 480),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.title = "Figxit Doctor"
        window.isReleasedWhenClosed = false

        let icon = NSImageView(image: NSApp.applicationIconImage)
        icon.translatesAutoresizingMaskIntoConstraints = false
        let title = NSTextField(labelWithString: "Figxit Doctor")
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
        let copy = NSButton(title: "Copy Report", target: self, action: #selector(copyReport))
        copy.toolTip = "Copies the checks as text, for a bug report"
        status.textColor = .secondaryLabelColor
        status.font = .systemFont(ofSize: 12)
        let actions = NSStackView(views: [again, copy, status])
        actions.spacing = 10

        let stack = NSStackView(views: [header, Panel.card("Checks", rows), actions])
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
            icon.widthAnchor.constraint(equalToConstant: 40),
            icon.heightAnchor.constraint(equalToConstant: 40),
        ])
        window.contentView = content
        self.window = window
    }

    @objc private func checkAgain() {
        reload()
        status.stringValue = "Checked."
    }

    @objc private func copyReport() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString("Figxit \(Install.version)\n\(report)", forType: .string)
        status.stringValue = "Copied."
    }
}
