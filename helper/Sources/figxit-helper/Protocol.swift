import Foundation

struct Grid: Decodable {
    let cols: Int
    let rows: Int
    let col: Int
    let row: Int
    let cellPxW: Double?
    let cellPxH: Double?
    let padX: Double?
    let padY: Double?
    let pane: Bool?
}

struct Item: Decodable {
    let label: String
    let detail: String?
    let icon: String?
    let tint: String?
}

struct Request: Decodable {
    let cmd: String
    let grid: Grid?
    let items: [Item]?
    let selected: Int?
}

struct Rect: Encodable {
    let x: Double
    let y: Double
    let w: Double
    let h: Double

    init(_ r: CGRect) {
        x = Double(r.minX)
        y = Double(r.minY)
        w = Double(r.width)
        h = Double(r.height)
    }
}

struct AXNode: Encodable {
    let depth: Int
    let role: String
    let frame: Rect?
}

struct Placement: Encodable {
    let source: String
    let surface: Rect
    let cellW: Double
    let cellH: Double
    let x: Double
    let yTop: Double
    let yBelow: Double
}

struct ProbeReply: Encodable {
    let app: String?
    let bundleId: String?
    let axTrusted: Bool
    let scale: Double
    let cgWindow: Rect?
    let axWindow: Rect?
    let axFocused: AXNode?
    let axTree: [AXNode]
    let placement: Placement?
}

struct StatusReply: Encodable {
    let ok: Bool
    let error: String?
    let placement: Placement?
}
