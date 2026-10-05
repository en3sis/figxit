import AppKit

final class PopupPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

enum IconStore {
    static let glyphBox: CGFloat = 13
    private static var cache: [String: NSImage] = [:]
    private static let directory: URL? = {
        if let override = ProcessInfo.processInfo.environment["FIGXIT_ICONS"] {
            return URL(fileURLWithPath: override)
        }
        return Bundle.main.resourceURL?.appendingPathComponent("icons")
    }()

    static func color(hex: String?) -> NSColor {
        guard let hex = hex, hex.count == 6, let value = UInt32(hex, radix: 16) else { return .systemGray }
        return NSColor(
            srgbRed: CGFloat((value >> 16) & 0xFF) / 255,
            green: CGFloat((value >> 8) & 0xFF) / 255,
            blue: CGFloat(value & 0xFF) / 255,
            alpha: 1
        )
    }

    static func luminance(_ color: NSColor) -> CGFloat {
        guard let c = color.usingColorSpace(.sRGB) else { return 0 }
        return 0.2126 * c.redComponent + 0.7152 * c.greenComponent + 0.0722 * c.blueComponent
    }

    static func glyph(_ name: String) -> NSImage? {
        if let hit = cache[name] { return hit }
        var image: NSImage?
        if name.hasPrefix("sf:") {
            let config = NSImage.SymbolConfiguration(pointSize: 11, weight: .semibold)
            image = NSImage(systemSymbolName: String(name.dropFirst(3)), accessibilityDescription: nil)?
                .withSymbolConfiguration(config)
        } else if name.hasPrefix("brand:"), let directory = directory {
            image = NSImage(contentsOf: directory.appendingPathComponent(String(name.dropFirst(6)) + ".svg"))
        }
        cache[name] = image
        return image
    }

    static func tinted(_ image: NSImage, color: NSColor) -> NSImage {
        let scale = min(glyphBox / max(image.size.width, 1), glyphBox / max(image.size.height, 1))
        let size = NSSize(width: image.size.width * scale, height: image.size.height * scale)
        return NSImage(size: size, flipped: false) { rect in
            image.draw(in: rect, from: .zero, operation: .sourceOver, fraction: 1)
            color.set()
            rect.fill(using: .sourceIn)
            return true
        }
    }
}

final class ListView: NSView {
    static let rowHeight: CGFloat = 28
    static let inset: CGFloat = 5
    static let tile: CGFloat = 20
    static let labelOffset: CGFloat = 36
    var background: NSColor?
    static let labelFont = NSFont.monospacedSystemFont(ofSize: 13, weight: .medium)
    static let detailFont = NSFont.systemFont(ofSize: 12)

    var items: [Item] = []
    var selected = 0

    override var isFlipped: Bool { true }

    static func size(for items: [Item]) -> NSSize {
        let widest = items.map { item -> CGFloat in
            let label = (item.label as NSString).size(withAttributes: [.font: labelFont]).width
            let detail = item.detail.map { ($0 as NSString).size(withAttributes: [.font: detailFont]).width + 24 } ?? 0
            return label + detail
        }.max() ?? 0
        let width = min(max(widest + 2 * inset + labelOffset + 14, 260), 580)
        return NSSize(width: width, height: CGFloat(items.count) * rowHeight + 2 * inset)
    }

    private func drawIcon(_ item: Item, in row: NSRect) {
        guard let name = item.icon, let glyph = IconStore.glyph(name) else { return }
        let tint = IconStore.color(hex: item.tint)
        let tile = NSRect(x: row.minX + 7, y: row.midY - Self.tile / 2, width: Self.tile, height: Self.tile)
        let path = NSBezierPath(roundedRect: tile, xRadius: 5.5, yRadius: 5.5)
        tint.setFill()
        path.fill()
        NSColor.white.withAlphaComponent(0.18).setStroke()
        path.lineWidth = 0.5
        path.stroke()
        let ink: NSColor = IconStore.luminance(tint) > 0.72 ? NSColor.black.withAlphaComponent(0.85) : .white
        let image = IconStore.tinted(glyph, color: ink)
        let target = NSRect(
            x: tile.midX - image.size.width / 2,
            y: tile.midY - image.size.height / 2,
            width: image.size.width,
            height: image.size.height
        )
        image.draw(in: target, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
    }

    override func draw(_ dirtyRect: NSRect) {
        if let background = background {
            background.setFill()
            bounds.fill()
        }
        for (index, item) in items.enumerated() {
            let row = NSRect(
                x: Self.inset,
                y: Self.inset + CGFloat(index) * Self.rowHeight,
                width: bounds.width - 2 * Self.inset,
                height: Self.rowHeight
            )
            let active = index == selected
            if active {
                NSColor.controlAccentColor.setFill()
                NSBezierPath(roundedRect: row, xRadius: 6, yRadius: 6).fill()
            }
            drawIcon(item, in: row)
            let labelColor: NSColor = active ? .white : .labelColor
            let detailColor: NSColor = active ? NSColor.white.withAlphaComponent(0.8) : .secondaryLabelColor
            let label = NSAttributedString(string: item.label, attributes: [.font: Self.labelFont, .foregroundColor: labelColor])
            let labelSize = label.size()
            label.draw(at: NSPoint(x: row.minX + Self.labelOffset, y: row.midY - labelSize.height / 2))
            if let text = item.detail {
                let detail = NSAttributedString(string: text, attributes: [.font: Self.detailFont, .foregroundColor: detailColor])
                let size = detail.size()
                let x = max(row.minX + Self.labelOffset + labelSize.width + 16, row.maxX - 10 - size.width)
                detail.draw(at: NSPoint(x: x, y: row.midY - size.height / 2))
            }
        }
    }
}

final class PopupController {
    private let panel: PopupPanel
    private let list = ListView()

    init() {
        panel = PopupPanel(
            contentRect: NSRect(x: 0, y: 0, width: 240, height: 100),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isFloatingPanel = true
        panel.level = .popUpMenu
        panel.hasShadow = true
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hidesOnDeactivate = false
        panel.ignoresMouseEvents = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
        panel.animationBehavior = .none

        list.autoresizingMask = [.width, .height]
        let glassOn = UserDefaults.standard.object(forKey: "glass") as? Bool ?? true
        if #available(macOS 26.0, *), glassOn {
            let glass = NSGlassEffectView()
            glass.cornerRadius = 12
            glass.contentView = list
            panel.contentView = glass
        } else {
            let background = NSVisualEffectView()
            background.material = .menu
            background.state = .active
            background.blendingMode = .behindWindow
            background.wantsLayer = true
            background.layer?.cornerRadius = 9
            background.layer?.masksToBounds = true
            background.layer?.borderWidth = 0.5
            background.layer?.borderColor = NSColor.separatorColor.cgColor
            background.addSubview(list)
            panel.contentView = background
        }
    }

    func show(items: [Item], selected: Int, placement: Placement) {
        guard !items.isEmpty else { return hide() }
        let size = ListView.size(for: items)
        let primary = Geometry.primaryHeight()
        let anchor = CGRect(x: placement.x, y: placement.yTop, width: 1, height: placement.yBelow - placement.yTop)
        let visible = (Geometry.screen(containing: anchor) ?? NSScreen.main)?.visibleFrame ?? .zero

        var top = primary - CGFloat(placement.yBelow) - 2
        if top - size.height < visible.minY {
            top = primary - CGFloat(placement.yTop) + size.height + 2
        }
        var x = CGFloat(placement.x)
        if x + size.width > visible.maxX { x = visible.maxX - size.width }
        if x < visible.minX { x = visible.minX }

        list.items = items
        list.selected = min(max(selected, 0), items.count - 1)
        panel.setFrame(NSRect(x: x, y: top - size.height, width: size.width, height: size.height), display: true)
        if list.superview === panel.contentView { list.frame = panel.contentView?.bounds ?? .zero }
        list.needsDisplay = true
        panel.orderFrontRegardless()
    }

    func hide() {
        panel.orderOut(nil)
    }
}
