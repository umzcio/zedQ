import Foundation
import Darwin
@_silgen_name("zq_clear_job_directory") private func clearJobDirectory(_ descriptor: Int32) -> Int32
@main struct ServiceMain {
    static func main() {
        let listener = NSXPCListener.service()
        let delegate = ServiceDelegate()
        listener.delegate = delegate
        listener.resume()
        RunLoop.current.run()
    }
}
final class ServiceDelegate: NSObject, NSXPCListenerDelegate {
    func listener(_ listener: NSXPCListener, shouldAcceptNewConnection connection: NSXPCConnection) -> Bool {
        guard connection.effectiveUserIdentifier == geteuid() else { return false }
        if #available(macOS 13.0, *) {
            // Enforced by XPC on peer messages; no PID lookup / reuse race.
            connection.setCodeSigningRequirement(allowedCallerRequirement)
        } else { return false }
        let helper = Helper()
        connection.exportedInterface = NSXPCInterface(with: SkillHelperProtocol.self)
        connection.exportedObject = helper
        connection.invalidationHandler = { helper.cancel() }
        connection.interruptionHandler = { helper.cancel() }
        connection.resume()
        return true
    }
}
final class Helper: NSObject, SkillHelperProtocol {
    private let lock = NSLock()
    private var active: Process?
    private var busy = false
    private var cancelled = false
    func ping(withReply reply: @escaping (Bool) -> Void) { reply(true) }
    func cancel() {
        lock.lock(); defer { lock.unlock() }
        cancelled = true
        if let process = active, process.isRunning {
            kill(process.processIdentifier, SIGTERM)
        }
    }
    func execute(_ request: Data, withReply reply: @escaping (Data) -> Void) {
        guard request.count <= 12 * 1024 * 1024,
              (try? JSONSerialization.jsonObject(with: request)) is [String: Any] else {
            reply(jsonData(["exitCode": 1, "error": "invalid or oversized request"])); return
        }
        lock.lock()
        if busy { lock.unlock(); reply(jsonData(["exitCode": 1, "error": "one active job per connection"])); return }
        busy = true; cancelled = false; lock.unlock()
        DispatchQueue.global().async { self.run(request, reply: reply) }
    }
    private func run(_ request: Data, reply: @escaping (Data) -> Void) {
        let start = Date()
        let manager = FileManager.default
        var job = manager.temporaryDirectory.appendingPathComponent("zq-skill-" + UUID().uuidString, isDirectory: true)
        var jobDescriptor: Int32 = -1
        var lease: JobLease?
        var result: [String: Any] = ["exitCode": 1, "files": []]
        defer {
            cancel()
            if jobDescriptor >= 0 {
                let cleaned = clearJobDirectory(jobDescriptor)
                close(jobDescriptor)
                let removed = rmdir(job.path)
                if (removed != 0 && errno != ENOENT) || (removed == 0 && cleaned != 0) {
                    result = ["exitCode": 1, "error": "temporary job cleanup incomplete", "files": []]
                }
            }
            lock.lock(); active = nil; busy = false; lock.unlock()
            withExtendedLifetime(lease) {}
            lease = nil
            result["durationMs"] = Int(Date().timeIntervalSince(start) * 1000)
            reply(jsonData(result))
        }
        do {
            lease = try JobLease.acquire()
            guard lease != nil else { result["error"] = "helper already has an active job"; return }
            job = lease!.jobs.appendingPathComponent("zq-skill-" + UUID().uuidString, isDirectory: true)
            try manager.createDirectory(at: job, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
            jobDescriptor = open(job.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
            guard jobDescriptor >= 0 else {
                try? manager.removeItem(at: job)
                throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
            }
            try request.write(to: job.appendingPathComponent("request.json"), options: .atomic)
            let process = Process()
            let resources = Bundle.main.resourceURL!
            process.executableURL = Bundle.main.bundleURL.appendingPathComponent("Contents/MacOS/SkillHelperSupervisor")
            process.arguments = [Bundle.main.bundleURL.appendingPathComponent("Contents/MacOS/SkillHelperWorker").path, resources.path, job.path, String(getpid())]
            process.currentDirectoryURL = job
            process.environment = [:]
            let output = Pipe(), errors = Pipe()
            process.standardInput = FileHandle(fileDescriptor: lease!.descriptor, closeOnDealloc: false)
            process.standardOutput = output; process.standardError = errors
            lock.lock()
            if cancelled { lock.unlock(); result = ["exitCode": 130, "error": "cancelled", "files": []]; return }
            do { try process.run() } catch { lock.unlock(); throw error }
            active = process; lock.unlock()
            let buffers = BoundedOutput()
            // Nonblocking reads keep inherited/escaped descriptors from extending the deadline.
            let handles = [output.fileHandleForReading, errors.fileHandleForReading]
            for handle in handles {
                let flags = fcntl(handle.fileDescriptor, F_GETFL)
                _ = fcntl(handle.fileDescriptor, F_SETFL, flags | O_NONBLOCK)
            }
            let deadline = ProcessInfo.processInfo.systemUptime + 30
            var resourceError: String?
            var scratch = [UInt8](repeating: 0, count: 65536)
            while true {
                for (index, handle) in handles.enumerated() {
                    // Limit draining per iteration so a writer cannot starve the watchdog.
                    for _ in 0..<32 {
                        let count = Darwin.read(handle.fileDescriptor, &scratch, scratch.count)
                        if count <= 0 { break }
                        if !buffers.append(Data(scratch[0..<count]), isError: index == 1) { cancel(); break }
                    }
                }
                if ProcessInfo.processInfo.systemUptime >= deadline { cancel() }
                if !process.isRunning { break }
                usleep(10000)
            }
            process.waitUntilExit()
            // Native supervisor owns worker lifetime, accounting and crash cleanup.
            switch process.terminationStatus {
            case 120: resourceError = "worker memory threshold exceeded"
            case 121: resourceError = "job file byte threshold exceeded"
            case 122: resourceError = "job file count or depth threshold exceeded"
            case 123: resourceError = "could not measure job resources"
            case 126: resourceError = "temporary job cleanup incomplete"
            default: break
            }
            for (index, handle) in handles.enumerated() {
                while true {
                    let count = Darwin.read(handle.fileDescriptor, &scratch, scratch.count)
                    if count <= 0 { break }
                    if !buffers.append(Data(scratch[0..<count]), isError: index == 1) { break }
                }
                try? handle.close()
            }
            var response = (try? JSONSerialization.jsonObject(with: buffers.stdout)) as? [String: Any]
            if response == nil || process.terminationStatus != 0 || buffers.overflow || resourceError != nil {
                response = ["exitCode": Int(process.terminationStatus == 0 ? 1 : process.terminationStatus),
                            "error": resourceError ?? (buffers.overflow ? "worker output limit exceeded" : "worker did not return a successful response"),
                            "stdout": "", "stderr": String(data: buffers.stderr, encoding: .utf8) ?? "", "files": []]
            }
            result = response!
        } catch {
            result = ["exitCode": 1, "error": error.localizedDescription, "files": []]
        }
    }
}
final class BoundedOutput {
    private let lock = NSLock()
    var stdout = Data(), stderr = Data()
    var overflow = false
    func append(_ data: Data, isError: Bool) -> Bool {
        lock.lock(); defer { lock.unlock() }
        if stdout.count + stderr.count + data.count > 12 * 1024 * 1024 { overflow = true; return false }
        if isError { stderr.append(data) } else { stdout.append(data) }
        return true
    }
}
