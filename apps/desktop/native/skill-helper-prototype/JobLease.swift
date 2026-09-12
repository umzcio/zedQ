import Foundation
import Darwin
@_silgen_name("zq_clear_job_directory") private func clearStagedJobs(_ descriptor: Int32) -> Int32

// Each XPC client can launch a separate service process. A process-local mutex
// alone therefore cannot enforce one active job for this helper identity.
final class JobLease {
    let descriptor: Int32
    let jobs: URL
    private init(_ descriptor: Int32, jobs: URL) { self.descriptor = descriptor; self.jobs = jobs }
    deinit { close(descriptor) }
    static func acquire() throws -> JobLease? {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("zq-native-helper-locks")
        if mkdir(directory.path, 0o700) != 0 && errno != EEXIST { throw failure() }
        let parent = open(directory.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard parent >= 0 else { throw failure() }
        defer { close(parent) }
        var info = stat()
        guard fstat(parent, &info) == 0, info.st_uid == geteuid(), info.st_mode & 0o077 == 0 else { throw failure() }
        let descriptor = openat(parent, serviceName + ".lock", O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard descriptor >= 0 else { throw failure() }
        guard fstat(descriptor, &info) == 0, info.st_uid == geteuid(), info.st_nlink == 1,
              info.st_mode & S_IFMT == S_IFREG, info.st_mode & 0o077 == 0 else {
            close(descriptor); throw failure()
        }
        if flock(descriptor, LOCK_EX | LOCK_NB) != 0 {
            let busy = errno == EWOULDBLOCK
            close(descriptor)
            if busy { return nil }
            throw failure()
        }
        // Keep the stable lock file: unlinking on release would permit two inodes
        // to be locked concurrently. The supervisor inherits this open file description. Close rather than
        // LOCK_UN so a service crash cannot unlock a still-running supervisor.
        let jobs = directory.appendingPathComponent(serviceName + ".jobs")
        if mkdirat(parent, serviceName + ".jobs", 0o700) != 0 && errno != EEXIST {
            close(descriptor); throw failure()
        }
        let staged = openat(parent, serviceName + ".jobs", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard staged >= 0 else { close(descriptor); throw failure() }
        defer { close(staged) }
        guard fstat(staged, &info) == 0, info.st_uid == geteuid(), info.st_mode & 0o077 == 0,
              clearStagedJobs(staged) == 0 else { close(descriptor); throw failure() }
        // Admission is held while recovering data left by a crash before launch.
        return JobLease(descriptor, jobs: jobs)
    }
    private static func failure() -> NSError {
        NSError(domain: "zQHelper", code: 1, userInfo: [NSLocalizedDescriptionKey: "could not acquire helper job lock"])
    }
}
