import AppKit

final class AboutWindow: NSObject {
    private var window: NSWindow?

    private static let links: [(title: String, symbol: String, url: String)] = [
        ("Website", "globe", "https://figxit.com"),
        ("GitHub", "chevron.left.forwardslash.chevron.right", "https://github.com/en3sis/figxit"),
        ("Discord", "bubble.left.and.bubble.right.fill", "https://discord.gg/Q34NWaC7pM"),
        ("X", "at", "https://x.com/en3sis"),
    ]

    func show() {
        if window == nil { build() }
        NSApp.activate(ignoringOtherApps: true)
        window?.center()
        window?.makeKeyAndOrderFront(nil)
    }

    private func label(_ text: String, size: CGFloat, weight: NSFont.Weight = .regular, color: NSColor = .labelColor) -> NSTextField {
        let field = NSTextField(wrappingLabelWithString: text)
        field.font = .systemFont(ofSize: size, weight: weight)
        field.textColor = color
        field.alignment = .center
        field.isSelectable = false
        return field
    }

    private func button(_ index: Int) -> NSButton {
        let link = Self.links[index]
        let button = NSButton(title: link.title, target: self, action: #selector(open(_:)))
        button.image = NSImage(systemSymbolName: link.symbol, accessibilityDescription: link.title)
        button.imagePosition = .imageLeading
        button.imageHugsTitle = true
        button.bezelStyle = .rounded
        button.controlSize = .large
        button.tag = index
        return button
    }

    private func build() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 440, height: 380),
            styleMask: [.titled, .closable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.isMovableByWindowBackground = true
        window.isReleasedWhenClosed = false

        let icon = NSImageView(image: NSApp.applicationIconImage)
        icon.imageScaling = .scaleProportionallyUpOrDown

        let name = label("Figxit", size: 22, weight: .semibold)
        let version = label("Version \(Install.version)", size: 12, color: .secondaryLabelColor)
        let about = label(
            "A native autocomplete popup for your terminal.\nNo account, no AI, no telemetry.",
            size: 13,
            color: .secondaryLabelColor
        )
        let buttons = NSStackView(views: Self.links.indices.map(button))
        buttons.spacing = 8
        let reach = label("Questions, bugs, and ideas are welcome.", size: 12, color: .secondaryLabelColor)
        let legal = label("MIT licence. Not affiliated with Fig, Amazon, or Kiro.", size: 11, color: .tertiaryLabelColor)

        let stack = NSStackView(views: [icon, name, version, about, reach, buttons, legal])
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 6
        stack.setCustomSpacing(14, after: icon)
        stack.setCustomSpacing(2, after: name)
        stack.setCustomSpacing(16, after: version)
        stack.setCustomSpacing(22, after: about)
        stack.setCustomSpacing(10, after: reach)
        stack.setCustomSpacing(22, after: buttons)
        stack.edgeInsets = NSEdgeInsets(top: 44, left: 28, bottom: 22, right: 28)
        stack.translatesAutoresizingMaskIntoConstraints = false

        let content = NSView()
        content.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            stack.topAnchor.constraint(equalTo: content.topAnchor),
            stack.bottomAnchor.constraint(equalTo: content.bottomAnchor),
            icon.widthAnchor.constraint(equalToConstant: 96),
            icon.heightAnchor.constraint(equalToConstant: 96),
            about.widthAnchor.constraint(equalToConstant: 360),
            content.widthAnchor.constraint(equalToConstant: 440),
        ])
        window.contentView = content
        self.window = window
    }

    @objc private func open(_ sender: NSButton) {
        guard let url = URL(string: Self.links[sender.tag].url) else { return }
        NSWorkspace.shared.open(url)
    }
}
