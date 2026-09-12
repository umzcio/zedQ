import Foundation
import Darwin
@main struct Client {
    static func main() {
        let connection = NSXPCConnection(serviceName: serviceName)
        connection.remoteObjectInterface = NSXPCInterface(with: SkillHelperProtocol.self)
        connection.resume()
        let finish: (Data) -> Void = { data in
            FileHandle.standardOutput.write(data)
            FileHandle.standardOutput.write(Data([10]))
            exit(0)
        }
        let proxy = connection.remoteObjectProxyWithErrorHandler { error in
            FileHandle.standardError.write(Data("XPC: \(error)\n".utf8))
            exit(1)
        } as! SkillHelperProtocol
        if let index = CommandLine.arguments.firstIndex(of: "--cancel-after-ms"),
           CommandLine.arguments.count > index + 1,
           let milliseconds = Int(CommandLine.arguments[index + 1]), milliseconds >= 0 {
            DispatchQueue.global().asyncAfter(deadline: .now() + .milliseconds(milliseconds)) { proxy.cancel() }
        }
        if CommandLine.arguments.contains("--ping") {
            proxy.ping { finish(jsonData(["pong": $0])) }
        } else {
            let request = FileHandle.standardInput.readData(ofLength: 12 * 1024 * 1024 + 1)
            guard request.count <= 12 * 1024 * 1024 else {
                finish(jsonData(["exitCode": 1, "error": "request exceeds limit"]))
                return
            }
            proxy.execute(request, withReply: finish)
        }
        DispatchQueue.global().asyncAfter(deadline: .now() + 35) { exit(124) }
        RunLoop.current.run()
    }
}
