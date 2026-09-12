#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <libproc.h>
#include <stdint.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <unistd.h>

#define ZQ_MEMORY_LIMIT (UINT64_C(256) * 1024 * 1024)
#define ZQ_FILE_LIMIT (UINT64_C(64) * 1024 * 1024)
#define ZQ_NODE_LIMIT 4096
#define ZQ_DEPTH_LIMIT 64

/* Consumes fd. Counts every descendant entry, including links and entries that
 * disappear during the walk, so concurrent changes cannot make work unbounded.
 * The root has depth zero and is not included in the descendant node count. */
static int sample_directory(int fd, unsigned depth, unsigned *nodes,
                            uint64_t *file_bytes) {
    DIR *directory = fdopendir(fd);
    if (!directory) {
        close(fd);
        return -1;
    }

    int result = 0;
    for (;;) {
        errno = 0;
        struct dirent *entry = readdir(directory);
        if (!entry) {
            if (errno != 0) result = -1;
            break;
        }
        if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0)
            continue;
        if (++*nodes > ZQ_NODE_LIMIT || depth + 1 > ZQ_DEPTH_LIMIT) {
            result = 3;
            break;
        }

        struct stat st;
        if (fstatat(fd, entry->d_name, &st, AT_SYMLINK_NOFOLLOW) != 0) {
            if (errno == ENOENT) continue;
            result = -1;
            break;
        }
        if (S_ISREG(st.st_mode)) {
            if (st.st_size < 0) {
                result = -1;
                break;
            }
            uint64_t size = (uint64_t)st.st_size;
            *file_bytes = size > UINT64_MAX - *file_bytes
                ? UINT64_MAX : *file_bytes + size;
            if (*file_bytes > ZQ_FILE_LIMIT) {
                result = 2;
                break;
            }
        } else if (S_ISDIR(st.st_mode)) {
            int child = openat(fd, entry->d_name,
                               O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
            if (child < 0) {
                if (errno == ENOENT) continue;
                result = -1;
                break;
            }
            /* A replacement between stat and open is not a trustworthy sample.
             * O_NOFOLLOW also prevents a replacement symlink from being opened. */
            struct stat opened;
            if (fstat(child, &opened) != 0 || opened.st_dev != st.st_dev ||
                opened.st_ino != st.st_ino) {
                close(child);
                result = -1;
                break;
            }
            result = sample_directory(child, depth + 1, nodes, file_bytes);
            if (result != 0) break;
        }
        /* Links and special files count as nodes but have no regular-file bytes.
         * In particular, do not open FIFOs/devices or follow symlink targets. */
    }
    if (closedir(directory) != 0 && result == 0) result = -1;
    return result;
}

/* Sampled watchdog, not a kernel quota or an atomic filesystem snapshot.
 * Returns 0 within limits; 1 memory >256 MiB; 2 regular-file logical bytes
 * >64 MiB; 3 >4096 descendant nodes or entry depth >64; -1 sampling failure.
 * Both outputs are required and reset each call. On early exit they contain
 * only the measurements obtained so far. Hard links count once per entry.
 * pid == 0 skips memory sampling for a final filesystem check after worker exit.
 * rootfd remains owned by the caller. Its directory offset is never changed.
 * proc_pid_rusage/RUSAGE_INFO_V2 and its byte fields are declared by the macOS
 * SDK in libproc.h and sys/resource.h. This monitors the one sandboxed process;
 * the helper's separate Seatbelt policy must prevent child processes. */
int zq_sample_job(int pid, int rootfd, uint64_t *memory_bytes, uint64_t *file_bytes) {
    if (memory_bytes) *memory_bytes = 0;
    if (file_bytes) *file_bytes = 0;
    if (!memory_bytes || !file_bytes || pid < 0 || rootfd < 0) return -1;

    if (pid != 0) {
        struct rusage_info_v2 usage = {0};
        if (proc_pid_rusage(pid, RUSAGE_INFO_V2, (rusage_info_t *)&usage) != 0)
            return -1;
        *memory_bytes = usage.ri_resident_size > usage.ri_phys_footprint
            ? usage.ri_resident_size : usage.ri_phys_footprint;
        if (*memory_bytes > ZQ_MEMORY_LIMIT) return 1;
    }

    /* dup() shares the directory offset. Reopen relative to the saved descriptor
     * to give every sampling pass a fresh, independent open file description. */
    int scanfd = openat(rootfd, ".", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (scanfd < 0) return -1;
    unsigned nodes = 0;
    return sample_directory(scanfd, 0, &nodes, file_bytes);
}
