import AppKit
import ApplicationServices

struct Terminal {
    let pid: pid_t
    let name: String?
    let bundleId: String?
}

enum Geometry {
    static let assumedTitlebar: CGFloat = 28
    static let physicalPixels = "com.mitchellh.ghostty"

    static func frontTerminal() -> Terminal? {
        guard let app = NSWorkspace.shared.frontmostApplication,
              app.processIdentifier != ProcessInfo.processInfo.processIdentifier
        else { return nil }
        return Terminal(pid: app.processIdentifier, name: app.localizedName, bundleId: app.bundleIdentifier)
    }

    static func cgWindow(pid: pid_t) -> (id: Int, frame: CGRect)? {
        let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
        guard let list = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else { return nil }
        for info in list {
            guard let owner = info[kCGWindowOwnerPID as String] as? pid_t, owner == pid,
                  let layer = info[kCGWindowLayer as String] as? Int, layer == 0,
                  let id = info[kCGWindowNumber as String] as? Int,
                  let bounds = info[kCGWindowBounds as String] as? [String: Any],
                  let rect = CGRect(dictionaryRepresentation: bounds as CFDictionary),
                  rect.width > 100, rect.height > 100
            else { continue }
            return (id, rect)
        }
        return nil
    }

    static func cgWindowFrame(pid: pid_t) -> CGRect? {
        cgWindow(pid: pid)?.frame
    }

    static func axAttribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
        return value
    }

    static func axElement(_ element: AXUIElement, _ name: String) -> AXUIElement? {
        guard let value = axAttribute(element, name), CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
        return (value as! AXUIElement)
    }

    static func axFrame(_ element: AXUIElement) -> CGRect? {
        guard let posValue = axAttribute(element, kAXPositionAttribute),
              let sizeValue = axAttribute(element, kAXSizeAttribute),
              CFGetTypeID(posValue) == AXValueGetTypeID(),
              CFGetTypeID(sizeValue) == AXValueGetTypeID()
        else { return nil }
        var point = CGPoint.zero
        var size = CGSize.zero
        guard AXValueGetValue(posValue as! AXValue, .cgPoint, &point),
              AXValueGetValue(sizeValue as! AXValue, .cgSize, &size)
        else { return nil }
        return CGRect(origin: point, size: size)
    }

    static func axRole(_ element: AXUIElement) -> String {
        (axAttribute(element, kAXRoleAttribute) as? String) ?? "?"
    }

    static func axFocused(pid: pid_t) -> (element: AXUIElement, node: AXNode)? {
        let app = AXUIElementCreateApplication(pid)
        guard let element = axElement(app, kAXFocusedUIElementAttribute) else { return nil }
        return (element, AXNode(depth: 0, role: axRole(element), frame: axFrame(element).map(Rect.init)))
    }

    static func axWindow(pid: pid_t) -> AXUIElement? {
        axElement(AXUIElementCreateApplication(pid), kAXFocusedWindowAttribute)
    }

    static func axTree(_ root: AXUIElement, maxDepth: Int = 5, limit: Int = 60) -> [AXNode] {
        var nodes: [AXNode] = []
        func walk(_ element: AXUIElement, _ depth: Int) {
            guard nodes.count < limit else { return }
            nodes.append(AXNode(depth: depth, role: axRole(element), frame: axFrame(element).map(Rect.init)))
            guard depth < maxDepth,
                  let children = axAttribute(element, kAXChildrenAttribute) as? [AXUIElement]
            else { return }
            for child in children { walk(child, depth + 1) }
        }
        walk(root, 0)
        return nodes
    }

    static func primaryHeight() -> CGFloat {
        NSScreen.screens.first?.frame.height ?? 0
    }

    static func screen(containing rect: CGRect) -> NSScreen? {
        let height = primaryHeight()
        let flipped = CGRect(x: rect.minX, y: height - rect.maxY, width: rect.width, height: rect.height)
        return NSScreen.screens.max { a, b in
            a.frame.intersection(flipped).width * a.frame.intersection(flipped).height
                < b.frame.intersection(flipped).width * b.frame.intersection(flipped).height
        }
    }

    static func cellPoints(px: Double?, scale: CGFloat, estimate: CGFloat) -> CGFloat {
        guard let px = px, px > 0 else { return estimate }
        let scaled = CGFloat(px) / scale
        let raw = CGFloat(px)
        return abs(scaled - estimate) <= abs(raw - estimate) ? scaled : raw
    }

    static func placement(grid: Grid, terminal: Terminal) -> Placement? {
        let padX = CGFloat(grid.padX ?? 0)
        let padY = CGFloat(grid.padY ?? 0)
        let cols = CGFloat(max(grid.cols, 1))
        let rows = CGFloat(max(grid.rows, 1))

        var surface: CGRect?
        var source = "cg"
        if AXIsProcessTrusted(), let focused = axFocused(pid: terminal.pid),
           let frame = axFrame(focused.element), frame.width > 100, frame.height > 100 {
            surface = frame
            source = "ax"
        }
        let window = cgWindowFrame(pid: terminal.pid)
        guard let base = surface ?? window else { return nil }

        let scale = screen(containing: base)?.backingScaleFactor ?? 2
        var cellW = cellPoints(px: grid.cellPxW, scale: scale, estimate: (base.width - 2 * padX) / cols)

        var cellH: CGFloat
        var top: CGFloat
        if source == "ax" {
            cellH = cellPoints(px: grid.cellPxH, scale: scale, estimate: (base.height - 2 * padY) / rows)
            top = base.minY
        } else if grid.cellPxH != nil {
            cellH = cellPoints(px: grid.cellPxH, scale: scale, estimate: (base.height - assumedTitlebar - 2 * padY) / rows)
            top = base.minY + max(0, base.height - rows * cellH - 2 * padY)
        } else {
            cellH = (base.height - assumedTitlebar - 2 * padY) / rows
            top = base.minY + assumedTitlebar
        }

        if grid.pane == true, source == "cg", let pxW = grid.cellPxW, let pxH = grid.cellPxH {
            let fits = cols * CGFloat(pxW) <= base.width * 1.02 && rows * CGFloat(pxH) <= base.height * 1.02
            let unit = terminal.bundleId == physicalPixels || !fits ? scale : 1
            cellW = CGFloat(pxW) / unit
            cellH = CGFloat(pxH) / unit
            let spareW = base.width - cols * cellW - 2 * padX
            let spareH = base.height - rows * cellH - 2 * padY
            if spareW < -0.02 * base.width || spareW > 0.12 * base.width { return nil }
            if spareH < -0.02 * base.height || spareH > max(100, 0.2 * base.height) { return nil }
            top = base.minY + max(0, spareH)
        } else if grid.pane == true, source == "cg", cellH < 1.6 * cellW || cellH > 3 * cellW {
            return nil
        }

        let x = base.minX + padX + CGFloat(grid.col) * cellW
        let yTop = top + padY + CGFloat(grid.row) * cellH
        return Placement(
            source: source,
            surface: Rect(base),
            cellW: Double(cellW),
            cellH: Double(cellH),
            x: Double(x),
            yTop: Double(yTop),
            yBelow: Double(yTop + cellH)
        )
    }

    static func probe(grid: Grid?) -> ProbeReply {
        let trusted = AXIsProcessTrusted()
        guard let terminal = frontTerminal() else {
            return ProbeReply(app: nil, bundleId: nil, axTrusted: trusted, scale: 0, cgWindow: nil,
                              axWindow: nil, axFocused: nil, axTree: [], placement: nil)
        }
        let cg = cgWindowFrame(pid: terminal.pid)
        let window = trusted ? axWindow(pid: terminal.pid) : nil
        let scale = cg.flatMap { screen(containing: $0)?.backingScaleFactor } ?? 0
        return ProbeReply(
            app: terminal.name,
            bundleId: terminal.bundleId,
            axTrusted: trusted,
            scale: Double(scale),
            cgWindow: cg.map(Rect.init),
            axWindow: window.flatMap(axFrame).map(Rect.init),
            axFocused: trusted ? axFocused(pid: terminal.pid)?.node : nil,
            axTree: window.map { axTree($0) } ?? [],
            placement: grid.flatMap { placement(grid: $0, terminal: terminal) }
        )
    }
}
