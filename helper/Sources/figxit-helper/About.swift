import AppKit

private final class Backdrop: NSView {
    override func draw(_ dirtyRect: NSRect) {
        NSColor.windowBackgroundColor.setFill()
        dirtyRect.fill()
    }
}

final class AboutWindow: NSObject {
    private enum Glyph {
        case symbol(String)
        case brand(String)
    }

    private struct Link {
        let title: String
        let glyph: Glyph
        let url: String
    }

    private static let project: [Link] = [
        Link(title: "Website", glyph: .symbol("globe"), url: "https://figxit.com"),
        Link(title: "GitHub", glyph: .brand("github"), url: "https://github.com/en3sis/figxit"),
        Link(title: "Discord", glyph: .brand("discord"), url: "https://discord.gg/Q34NWaC7pM"),
    ]

    private static let credit: [(text: String, url: String?)] = [
        ("Made by ", nil),
        ("en3sis", "https://en3sis.com"),
        (", say hi on ", nil),
        ("X", "https://x.com/en3sis"),
        (".", nil),
    ]

    private static let glyphSize: CGFloat = 15
    private static let buttonWidth: CGFloat = 116

    private var window: NSWindow?
    private var urls: [String] = []

    func show() {
        if window == nil { build() }
        NSApp.activate(ignoringOtherApps: true)
        window?.center()
        window?.makeKeyAndOrderFront(nil)
    }

    func render(to outPath: String, dark: Bool) -> Bool {
        if window == nil { build() }
        guard let window = window, let view = window.contentView else { return false }
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        view.layoutSubtreeIfNeeded()
        window.displayIfNeeded()
        guard let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return false }
        view.cacheDisplay(in: view.bounds, to: rep)
        guard let png = rep.representation(using: .png, properties: [:]) else { return false }
        return FileManager.default.createFile(atPath: outPath, contents: png)
    }

    private func label(_ text: String, size: CGFloat, weight: NSFont.Weight = .regular, color: NSColor = .labelColor) -> NSTextField {
        let field = NSTextField(wrappingLabelWithString: text)
        field.font = .systemFont(ofSize: size, weight: weight)
        field.textColor = color
        field.alignment = .center
        field.isSelectable = false
        return field
    }

    private func image(_ glyph: Glyph, title: String) -> NSImage? {
        switch glyph {
        case .symbol(let name):
            return NSImage(systemSymbolName: name, accessibilityDescription: title)?
                .withSymbolConfiguration(NSImage.SymbolConfiguration(pointSize: Self.glyphSize - 1, weight: .medium))
        case .brand(let slug):
            guard let url = Bundle.main.resourceURL?.appendingPathComponent("icons/\(slug).svg"),
                  let svg = NSImage(contentsOf: url)
            else { return nil }
            let scale = Self.glyphSize / max(svg.size.width, svg.size.height, 1)
            svg.size = NSSize(width: svg.size.width * scale, height: svg.size.height * scale)
            svg.isTemplate = true
            svg.accessibilityDescription = title
            return svg
        }
    }

    private func button(_ link: Link) -> NSButton {
        let button = NSButton(title: link.title, target: self, action: #selector(open(_:)))
        button.image = image(link.glyph, title: link.title)
        button.imagePosition = .imageLeading
        button.imageHugsTitle = true
        button.bezelStyle = .rounded
        button.controlSize = .large
        button.tag = urls.count
        button.widthAnchor.constraint(equalToConstant: Self.buttonWidth).isActive = true
        urls.append(link.url)
        return button
    }

    private func row(_ links: [Link]) -> NSStackView {
        let row = NSStackView(views: links.map(button))
        row.spacing = 8
        return row
    }

    private func heading(_ text: String) -> NSTextField {
        label(text, size: 11, weight: .semibold, color: .secondaryLabelColor)
    }

    private func creditLine() -> NSTextField {
        let centered = NSMutableParagraphStyle()
        centered.alignment = .center
        let text = NSMutableAttributedString()
        for part in Self.credit {
            var attributes: [NSAttributedString.Key: Any] = [
                .font: NSFont.systemFont(ofSize: 12),
                .foregroundColor: NSColor.secondaryLabelColor,
                .paragraphStyle: centered,
            ]
            if let url = part.url.flatMap(URL.init(string:)) {
                attributes[.link] = url
                attributes[.foregroundColor] = NSColor.linkColor
            }
            text.append(NSAttributedString(string: part.text, attributes: attributes))
        }
        let field = NSTextField(labelWithAttributedString: text)
        field.isSelectable = true
        field.allowsEditingTextAttributes = true
        return field
    }

    private func build() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 440, height: 460),
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

        let projectHeading = heading("Project")
        let projectRow = row(Self.project)
        let reach = label("Questions, bugs, and ideas are welcome.", size: 12, color: .secondaryLabelColor)

        let divider = NSBox()
        divider.boxType = .separator

        let credit = creditLine()

        let legal = label("MIT licence. Not affiliated with Fig, Amazon, or Kiro.", size: 11, color: .tertiaryLabelColor)

        let stack = NSStackView(views: [
            icon, name, version, about,
            projectHeading, projectRow, reach,
            divider,
            credit,
            legal,
        ])
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 6
        stack.setCustomSpacing(14, after: icon)
        stack.setCustomSpacing(2, after: name)
        stack.setCustomSpacing(16, after: version)
        stack.setCustomSpacing(24, after: about)
        stack.setCustomSpacing(8, after: projectHeading)
        stack.setCustomSpacing(10, after: projectRow)
        stack.setCustomSpacing(18, after: reach)
        stack.setCustomSpacing(18, after: divider)
        stack.setCustomSpacing(10, after: credit)
        stack.edgeInsets = NSEdgeInsets(top: 44, left: 28, bottom: 22, right: 28)
        stack.translatesAutoresizingMaskIntoConstraints = false

        let content = Backdrop()
        content.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            stack.topAnchor.constraint(equalTo: content.topAnchor),
            stack.bottomAnchor.constraint(equalTo: content.bottomAnchor),
            icon.widthAnchor.constraint(equalToConstant: 96),
            icon.heightAnchor.constraint(equalToConstant: 96),
            about.widthAnchor.constraint(equalToConstant: 360),
            divider.widthAnchor.constraint(equalToConstant: 360),
            content.widthAnchor.constraint(equalToConstant: 440),
        ])
        window.contentView = content
        content.layoutSubtreeIfNeeded()
        window.setContentSize(content.fittingSize)
        self.window = window
    }

    @objc private func open(_ sender: NSButton) {
        guard urls.indices.contains(sender.tag), let url = URL(string: urls[sender.tag]) else { return }
        NSWorkspace.shared.open(url)
    }
}
