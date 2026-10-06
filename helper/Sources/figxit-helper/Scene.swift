import AppKit

enum Scene {
    static let width: CGFloat = 760
    static let margin: CGFloat = 30
    static let bar: CGFloat = 38
    static let line: CGFloat = 22

    private static func bitmap(_ size: NSSize) -> NSBitmapImageRep? {
        let rep = NSBitmapImageRep(
            bitmapDataPlanes: nil, pixelsWide: Int(size.width * 2), pixelsHigh: Int(size.height * 2),
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
            colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
        )
        rep?.size = size
        return rep
    }

    private static func list(_ items: [Item], dark: Bool) -> NSImage? {
        let view = ListView(frame: NSRect(origin: .zero, size: ListView.size(for: items)))
        let appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        view.appearance = appearance
        view.items = items
        view.selected = 0
        view.background = dark ? NSColor(white: 0.17, alpha: 1) : NSColor(white: 0.96, alpha: 1)
        guard let rep = bitmap(view.bounds.size) else { return nil }
        appearance?.performAsCurrentDrawingAppearance { view.cacheDisplay(in: view.bounds, to: rep) }
        let image = NSImage(size: view.bounds.size)
        image.addRepresentation(rep)
        return image
    }

    static func render(items: [Item], buffer: String, folder: String, dark: Bool, outPath: String) -> Bool {
        guard let popup = list(items, dark: dark) else { return false }
        let window = NSRect(x: margin, y: margin - 8, width: width - 2 * margin, height: bar + 20 + line + 6 + popup.size.height + 30)
        let size = NSSize(width: width, height: window.height + 2 * margin)
        guard let rep = bitmap(size), let base = NSGraphicsContext(bitmapImageRep: rep) else { return false }
        base.cgContext.translateBy(x: 0, y: size.height)
        base.cgContext.scaleBy(x: 1, y: -1)
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(cgContext: base.cgContext, flipped: true)
        defer { NSGraphicsContext.restoreGraphicsState() }

        let ground = dark ? NSColor(srgbRed: 0.09, green: 0.09, blue: 0.11, alpha: 1) : NSColor.white
        let chrome = dark ? NSColor(srgbRed: 0.14, green: 0.14, blue: 0.17, alpha: 1) : NSColor(srgbRed: 0.95, green: 0.95, blue: 0.96, alpha: 1)
        let edge = dark ? NSColor(white: 1, alpha: 0.14) : NSColor(white: 0, alpha: 0.14)
        let text = dark ? NSColor(white: 0.92, alpha: 1) : NSColor(white: 0.11, alpha: 1)
        let dim = dark ? NSColor(white: 0.52, alpha: 1) : NSColor(white: 0.55, alpha: 1)
        let accent = NSColor(srgbRed: 0.37, green: 0.36, blue: 0.9, alpha: 1)

        let frame = NSBezierPath(roundedRect: window, xRadius: 12, yRadius: 12)
        NSGraphicsContext.saveGraphicsState()
        let shade = NSShadow()
        shade.shadowColor = NSColor(white: 0, alpha: dark ? 0.5 : 0.18)
        shade.shadowBlurRadius = 22
        shade.shadowOffset = NSSize(width: 0, height: -8)
        shade.set()
        ground.setFill()
        frame.fill()
        NSGraphicsContext.restoreGraphicsState()

        NSGraphicsContext.saveGraphicsState()
        frame.addClip()
        chrome.setFill()
        NSRect(x: window.minX, y: window.minY, width: window.width, height: bar).fill()
        edge.setFill()
        NSRect(x: window.minX, y: window.minY + bar - 0.5, width: window.width, height: 0.5).fill()
        NSGraphicsContext.restoreGraphicsState()
        edge.setStroke()
        frame.lineWidth = 1
        frame.stroke()

        let dots: [NSColor] = [
            NSColor(srgbRed: 1, green: 0.37, blue: 0.34, alpha: 1),
            NSColor(srgbRed: 1, green: 0.74, blue: 0.18, alpha: 1),
            NSColor(srgbRed: 0.16, green: 0.78, blue: 0.25, alpha: 1),
        ]
        for (index, color) in dots.enumerated() {
            color.setFill()
            NSBezierPath(ovalIn: NSRect(x: window.minX + 16 + CGFloat(index) * 20, y: window.minY + bar / 2 - 6, width: 12, height: 12)).fill()
        }
        let title = NSAttributedString(string: "zsh", attributes: [.font: NSFont.systemFont(ofSize: 12, weight: .medium), .foregroundColor: dim])
        title.draw(at: NSPoint(x: window.midX - title.size().width / 2, y: window.minY + bar / 2 - title.size().height / 2))

        let mono = NSFont.monospacedSystemFont(ofSize: 14, weight: .regular)
        let lead = NSMutableAttributedString(string: folder, attributes: [.font: mono, .foregroundColor: dim])
        lead.append(NSAttributedString(string: " \u{276F} ", attributes: [.font: mono, .foregroundColor: accent]))
        let typed = NSAttributedString(string: buffer, attributes: [.font: mono, .foregroundColor: text])
        let left = window.minX + 20
        let top = window.minY + bar + 20
        lead.draw(at: NSPoint(x: left, y: top))
        typed.draw(at: NSPoint(x: left + lead.size().width, y: top))
        accent.withAlphaComponent(0.85).setFill()
        NSRect(x: left + lead.size().width + typed.size().width + 1, y: top + 1, width: 8, height: 17).fill()

        let start = buffer.lastIndex(of: " ").map { buffer.index(after: $0) } ?? buffer.startIndex
        let before = NSAttributedString(string: String(buffer[..<start]), attributes: [.font: mono])
        var x = left + lead.size().width + before.size().width - 8
        x = max(window.minX + 12, min(x, window.maxX - 16 - popup.size.width))
        let box = NSRect(x: x, y: top + line + 6, width: popup.size.width, height: popup.size.height)
        let shape = NSBezierPath(roundedRect: box, xRadius: 10, yRadius: 10)
        NSGraphicsContext.saveGraphicsState()
        let lift = NSShadow()
        lift.shadowColor = NSColor(white: 0, alpha: dark ? 0.55 : 0.22)
        lift.shadowBlurRadius = 16
        lift.shadowOffset = NSSize(width: 0, height: -6)
        lift.set()
        ground.setFill()
        shape.fill()
        NSGraphicsContext.restoreGraphicsState()
        NSGraphicsContext.saveGraphicsState()
        shape.addClip()
        popup.draw(in: box, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
        NSGraphicsContext.restoreGraphicsState()
        edge.setStroke()
        shape.lineWidth = 0.5
        shape.stroke()

        guard let png = rep.representation(using: .png, properties: [:]) else { return false }
        return FileManager.default.createFile(atPath: outPath, contents: png)
    }
}
