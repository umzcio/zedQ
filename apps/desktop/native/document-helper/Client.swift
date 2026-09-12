import Foundation
import Darwin
@main struct Client {
    static func main() {
        guard CommandLine.arguments.count == 1 else { exit(64) }
        let connection = NSXPCConnection(serviceName: serviceName)
        connection.remoteObjectInterface = NSXPCInterface(with: DocumentHelperProtocol.self)
        connection.resume()
        let proxy = connection.remoteObjectProxyWithErrorHandler { error in
            FileHandle.standardError.write(Data("Document helper: \(error.localizedDescription)\n".utf8))
            exit(1)
        } as! DocumentHelperProtocol
        // Host abort terminates this caller. Invalidate XPC even while stdin is
        // incomplete so cancellation never depends on receiving a complete request.
        signal(SIGTERM, SIG_IGN); signal(SIGINT, SIG_IGN); signal(SIGPIPE, SIG_IGN)
        let signals = [SIGTERM, SIGINT].map { number -> DispatchSourceSignal in
            let source = DispatchSource.makeSignalSource(signal: number, queue: .global())
            source.setEventHandler { proxy.cancel(); connection.invalidate(); exit(130) }
            source.resume(); return source
        }
        DispatchQueue.global().asyncAfter(deadline: .now() + 32) {
            proxy.cancel(); connection.invalidate(); exit(124)
        }
        DispatchQueue.global().async {
            var request = Data()
            do {
                while let chunk = try FileHandle.standardInput.read(upToCount: min(65536, 1024 * 1024 + 1 - request.count)), !chunk.isEmpty {
                    request.append(chunk)
                    if request.count > 1024 * 1024 { break }
                }
            } catch { connection.invalidate(); exit(74) }
            guard validRequest(request) else {
                FileHandle.standardOutput.write(jsonData(["version": 1, "ok": false, "error": "Invalid or oversized document request."]))
                connection.invalidate(); exit(0)
            }
            proxy.execute(request) { data in
                guard data.count <= 6 * 1024 * 1024 else { connection.invalidate(); exit(65) }
                FileHandle.standardOutput.write(data)
                FileHandle.standardOutput.write(Data([10]))
                connection.invalidate(); exit(0)
            }
        }
        withExtendedLifetime(signals) { RunLoop.current.run() }
    }
}
