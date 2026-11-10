import Cocoa
import InputMethodKit

let request = Notification.Name("dev.figxit.caret.request")
let reply = Notification.Name("dev.figxit.caret.reply")

@objc(FigxitInputController)
final class FigxitInputController: IMKInputController {
    private var active = false

    override init!(server: IMKServer!, delegate: Any!, client inputClient: Any!) {
        super.init(server: server, delegate: delegate, client: inputClient)
        DistributedNotificationCenter.default().addObserver(self, selector: #selector(answer(_:)), name: request, object: nil)
    }

    deinit {
        DistributedNotificationCenter.default().removeObserver(self)
    }

    override func activateServer(_ sender: Any!) {
        active = true
    }

    override func deactivateServer(_ sender: Any!) {
        active = false
    }

    @objc private func answer(_ note: Notification) {
        guard active, let client = client(), let id = note.userInfo?["id"] as? Int else { return }
        var rect = NSRect.zero
        _ = client.attributes(forCharacterIndex: 0, lineHeightRectangle: &rect)
        guard rect.height > 0 else { return }
        DistributedNotificationCenter.default().postNotificationName(
            reply,
            object: nil,
            userInfo: [
                "id": id,
                "bundle": client.bundleIdentifier() ?? "",
                "x": Double(rect.minX),
                "y": Double(rect.minY),
                "w": Double(rect.width),
                "h": Double(rect.height),
            ],
            deliverImmediately: true
        )
    }
}

let name = Bundle.main.infoDictionary?["InputMethodConnectionName"] as? String
let server = IMKServer(name: name, bundleIdentifier: Bundle.main.bundleIdentifier)
NSApplication.shared.run()
