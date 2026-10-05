import Foundation

final class SocketServer {
    private let path: String
    private let handler: (Data) -> Data?
    private var listenFd: Int32 = -1
    private var acceptSource: DispatchSourceRead?
    private var clients: [Int32: (source: DispatchSourceRead, buffer: Data)] = [:]

    init(path: String, handler: @escaping (Data) -> Data?) {
        self.path = path
        self.handler = handler
    }

    private func address() -> sockaddr_un? {
        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        let bytes = Array(path.utf8)
        let capacity = MemoryLayout.size(ofValue: addr.sun_path)
        guard bytes.count < capacity else { return nil }
        withUnsafeMutableBytes(of: &addr.sun_path) { buffer in
            for (index, byte) in bytes.enumerated() { buffer[index] = byte }
        }
        return addr
    }

    private func withAddress(_ body: (UnsafePointer<sockaddr>, socklen_t) -> Int32) -> Int32 {
        guard var addr = address() else { return -1 }
        return withUnsafePointer(to: &addr) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                body($0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
    }

    func alreadyRunning() -> Bool {
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { return false }
        defer { close(fd) }
        return withAddress { connect(fd, $0, $1) } == 0
    }

    func start() -> Bool {
        signal(SIGPIPE, SIG_IGN)
        try? FileManager.default.createDirectory(
            atPath: (path as NSString).deletingLastPathComponent,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        chmod((path as NSString).deletingLastPathComponent, 0o700)
        unlink(path)
        listenFd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard listenFd >= 0, withAddress({ bind(listenFd, $0, $1) }) == 0, listen(listenFd, 8) == 0 else {
            return false
        }
        chmod(path, 0o600)
        let source = DispatchSource.makeReadSource(fileDescriptor: listenFd, queue: .main)
        source.setEventHandler { [weak self] in self?.acceptClient() }
        source.resume()
        acceptSource = source
        return true
    }

    func broadcast(_ message: Data) {
        var line = message
        line.append(0x0A)
        for fd in clients.keys {
            line.withUnsafeBytes { _ = write(fd, $0.baseAddress, $0.count) }
        }
    }

    private func acceptClient() {
        let fd = accept(listenFd, nil, nil)
        guard fd >= 0 else { return }
        var on: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &on, socklen_t(MemoryLayout<Int32>.size))
        let source = DispatchSource.makeReadSource(fileDescriptor: fd, queue: .main)
        source.setEventHandler { [weak self] in self?.readClient(fd) }
        source.setCancelHandler { close(fd) }
        clients[fd] = (source, Data())
        source.resume()
    }

    private func readClient(_ fd: Int32) {
        var chunk = [UInt8](repeating: 0, count: 65536)
        let count = read(fd, &chunk, chunk.count)
        guard count > 0, var client = clients[fd] else {
            clients[fd]?.source.cancel()
            clients[fd] = nil
            return
        }
        client.buffer.append(contentsOf: chunk[0..<count])
        while let newline = client.buffer.firstIndex(of: 0x0A) {
            let line = client.buffer.subdata(in: client.buffer.startIndex..<newline)
            client.buffer.removeSubrange(client.buffer.startIndex...newline)
            guard !line.isEmpty, var reply = handler(line) else { continue }
            reply.append(0x0A)
            reply.withUnsafeBytes { _ = write(fd, $0.baseAddress, $0.count) }
        }
        clients[fd] = client
    }
}
