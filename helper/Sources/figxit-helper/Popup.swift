import AppKit

final class PopupPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

enum IconStore {
    static let glyphBox: CGFloat = 13
    private static var cache: [String: NSImage] = [:]
    private static var inked: [String: NSImage] = [:]
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
            image = symbol(String(name.dropFirst(3)))
        } else if name.hasPrefix("brand:"), let directory = directory,
                  let svg = NSImage(contentsOf: directory.appendingPathComponent(String(name.dropFirst(6)) + ".svg")) {
            let scale = glyphBox / max(svg.size.width, svg.size.height, 1)
            svg.size = NSSize(width: (svg.size.width * scale).rounded(), height: (svg.size.height * scale).rounded())
            image = svg
        }
        cache[name] = image
        return image
    }

    static func symbol(_ name: String) -> NSImage? {
        func sized(_ points: CGFloat) -> NSImage? {
            NSImage(systemSymbolName: name, accessibilityDescription: nil)?
                .withSymbolConfiguration(NSImage.SymbolConfiguration(pointSize: points, weight: .semibold))
        }
        guard let natural = sized(11) else { return nil }
        return sized(11 * glyphBox / max(natural.size.width, natural.size.height, 1)) ?? natural
    }

    static func inked(_ name: String, dark: Bool) -> NSImage? {
        let key = "\(name)|\(dark)"
        if let hit = inked[key] { return hit }
        guard let glyph = glyph(name) else { return nil }
        let image = tinted(glyph, color: dark ? NSColor.black.withAlphaComponent(0.85) : .white)
        inked[key] = image
        return image
    }

    static func tinted(_ image: NSImage, color: NSColor) -> NSImage {
        NSImage(size: image.size, flipped: false) { rect in
            image.draw(in: rect, from: .zero, operation: .sourceOver, fraction: 1)
            color.set()
            rect.fill(using: .sourceIn)
            return true
        }
    }
}

struct ListMetrics {
    let rowHeight: CGFloat
    let inset: CGFloat
    let tile: CGFloat
    let tileRadius: CGFloat
    let tileX: CGFloat
    let labelOffset: CGFloat
    let rowRadius: CGFloat
    let minWidth: CGFloat
    let detailGap: CGFloat
    let corner: CGFloat
    let labelFont: NSFont
    let detailFont: NSFont

    static let regular = ListMetrics(
        rowHeight: 28, inset: 5, tile: 20, tileRadius: 5.5, tileX: 7, labelOffset: 36, rowRadius: 6,
        minWidth: 260, detailGap: 16, corner: 12,
        labelFont: .monospacedSystemFont(ofSize: 13, weight: .medium),
        detailFont: .systemFont(ofSize: 12)
    )

    static let compact = ListMetrics(
        rowHeight: 20, inset: 3, tile: 15, tileRadius: 4, tileX: 4, labelOffset: 25, rowRadius: 4,
        minWidth: 180, detailGap: 10, corner: 8,
        labelFont: .monospacedSystemFont(ofSize: 11.5, weight: .medium),
        detailFont: .systemFont(ofSize: 10.5)
    )

    static var compactEnabled: Bool {
        get { UserDefaults.standard.bool(forKey: "compact") }
        set { UserDefaults.standard.set(newValue, forKey: "compact") }
    }

    static var current: ListMetrics { compactEnabled ? compact : regular }
}

enum PopupTheme: String, CaseIterable {
    case system, light, dark

    static var current: PopupTheme {
        get { UserDefaults.standard.string(forKey: "theme").flatMap(PopupTheme.init(rawValue:)) ?? .system }
        set { UserDefaults.standard.set(newValue.rawValue, forKey: "theme") }
    }

    var title: String { rawValue.prefix(1).uppercased() + rawValue.dropFirst() }

    var appearance: NSAppearance? {
        switch self {
        case .system: return nil
        case .light: return NSAppearance(named: .aqua)
        case .dark: return NSAppearance(named: .darkAqua)
        }
    }
}

final class ListView: NSView {
    static let maxWidth: CGFloat = 580
    var background: NSColor?
    var metrics = ListMetrics.current

    var items: [Item] = []
    var selected = 0

    override var isFlipped: Bool { true }

    static func size(for items: [Item], metrics m: ListMetrics = .current) -> NSSize {
        let widest = items.map { item -> CGFloat in
            let label = (item.label as NSString).size(withAttributes: [.font: m.labelFont]).width
            let detail = item.detail.map { ($0 as NSString).size(withAttributes: [.font: m.detailFont]).width + m.detailGap + 8 } ?? 0
            return label + detail
        }.max() ?? 0
        let width = min(max(widest + 2 * m.inset + m.labelOffset + 14, m.minWidth), maxWidth)
        return NSSize(width: width, height: CGFloat(items.count) * m.rowHeight + 2 * m.inset)
    }

    private func drawIcon(_ item: Item, in row: NSRect) {
        guard let name = item.icon else { return }
        let tint = IconStore.color(hex: item.tint)
        guard let image = IconStore.inked(name, dark: IconStore.luminance(tint) > 0.72) else { return }
        let tile = NSRect(x: row.minX + metrics.tileX, y: row.midY - metrics.tile / 2, width: metrics.tile, height: metrics.tile)
        let path = NSBezierPath(roundedRect: tile, xRadius: metrics.tileRadius, yRadius: metrics.tileRadius)
        tint.setFill()
        path.fill()
        NSColor.white.withAlphaComponent(0.18).setStroke()
        path.lineWidth = 0.5
        path.stroke()
        let scale = min(1, metrics.tile / ListMetrics.regular.tile)
        let glyph = NSSize(width: (image.size.width * scale).rounded(), height: (image.size.height * scale).rounded())
        let target = backingAlignedRect(NSRect(
            x: tile.midX - glyph.width / 2,
            y: tile.midY - glyph.height / 2,
            width: glyph.width,
            height: glyph.height
        ), options: .alignAllEdgesNearest)
        image.draw(in: target, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
    }

    func rowRect(_ index: Int) -> NSRect {
        NSRect(x: metrics.inset, y: metrics.inset + CGFloat(index) * metrics.rowHeight, width: bounds.width - 2 * metrics.inset, height: metrics.rowHeight)
    }

    func select(_ index: Int) {
        guard index != selected else { return }
        for row in [selected, index] where row >= 0 && row < items.count { setNeedsDisplay(rowRect(row)) }
        selected = index
    }

    override func draw(_ dirtyRect: NSRect) {
        if let background = background {
            background.setFill()
            bounds.fill()
        }
        for (index, item) in items.enumerated() {
            let row = rowRect(index)
            guard row.intersects(dirtyRect) else { continue }
            let active = index == selected
            if active {
                NSColor.controlAccentColor.setFill()
                NSBezierPath(roundedRect: row, xRadius: metrics.rowRadius, yRadius: metrics.rowRadius).fill()
            }
            drawIcon(item, in: row)
            let labelColor: NSColor = active ? .white : .labelColor
            let detailColor: NSColor = active ? NSColor.white.withAlphaComponent(0.8) : .secondaryLabelColor
            let label = NSAttributedString(string: item.label, attributes: [.font: metrics.labelFont, .foregroundColor: labelColor])
            let labelSize = label.size()
            label.draw(at: NSPoint(x: row.minX + metrics.labelOffset, y: row.midY - labelSize.height / 2))
            if let text = item.detail {
                let detail = NSAttributedString(string: text, attributes: [.font: metrics.detailFont, .foregroundColor: detailColor])
                let size = detail.size()
                let x = max(row.minX + metrics.labelOffset + labelSize.width + metrics.detailGap, row.maxX - 10 - size.width)
                detail.draw(at: NSPoint(x: x, y: row.midY - size.height / 2))
            }
        }
    }
}

final class PopupController {
    private let panel: PopupPanel
    private let list = ListView()
    private var glass: NSView?
    private var fallback: NSVisualEffectView?
    private var width: CGFloat = 0
    static let widthStep: CGFloat = 20
    static let fade: TimeInterval = 0.08

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
            self.glass = glass
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
            fallback = background
        }
    }

    func show(items: [Item], selected: Int, placement: Placement) {
        guard !items.isEmpty else { return hide() }
        let opening = !panel.isVisible
        if opening {
            applyMetrics(.current)
            applyTheme(.current)
        }
        let needed = ListView.size(for: items, metrics: list.metrics)
        width = min(max(opening ? 0 : width, (needed.width / Self.widthStep).rounded(.up) * Self.widthStep), ListView.maxWidth)
        let size = NSSize(width: width, height: needed.height)
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
        list.selected = selected < 0 ? -1 : min(selected, items.count - 1)
        let frame = NSRect(x: x, y: top - size.height, width: size.width, height: size.height)
        if panel.frame != frame { panel.setFrame(frame, display: false) }
        if list.superview === panel.contentView { list.frame = panel.contentView?.bounds ?? .zero }
        list.needsDisplay = true
        guard opening else { return }
        panel.alphaValue = 0
        panel.orderFrontRegardless()
        NSAnimationContext.runAnimationGroup { context in
            context.duration = Self.fade
            context.timingFunction = CAMediaTimingFunction(name: .easeOut)
            panel.animator().alphaValue = 1
        }
    }

    private func applyMetrics(_ metrics: ListMetrics) {
        list.metrics = metrics
        if #available(macOS 26.0, *), let glass = glass as? NSGlassEffectView {
            glass.cornerRadius = metrics.corner
        }
        fallback?.layer?.cornerRadius = metrics.corner - 3
    }

    private func applyTheme(_ theme: PopupTheme) {
        panel.appearance = theme.appearance
        guard let fallback = fallback else { return }
        fallback.effectiveAppearance.performAsCurrentDrawingAppearance {
            fallback.layer?.borderColor = NSColor.separatorColor.cgColor
        }
    }

    func select(_ index: Int) {
        list.select(index)
    }

    func hide() {
        panel.orderOut(nil)
        panel.alphaValue = 1
    }
}
