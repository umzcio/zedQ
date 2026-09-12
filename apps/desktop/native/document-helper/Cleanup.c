// Trusted service-side cleanup. Never follow links supplied by executed code.
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static int clear_directory(int fd, unsigned depth) {
    if (depth > 256) { errno = ELOOP; return -1; }
    if (fchmod(fd, 0700)) return -1;
    int copy = dup(fd);
    if (copy < 0) return -1;
    DIR *stream = fdopendir(copy);
    if (!stream) { close(copy); return -1; }
    int result = 0;
    struct dirent *entry;
    while ((entry = readdir(stream))) {
        const char *name = entry->d_name;
        if (!strcmp(name, ".") || !strcmp(name, "..")) continue;
        struct stat before, opened;
        if (fstatat(fd, name, &before, AT_SYMLINK_NOFOLLOW)) { result = -1; continue; }
        if (S_ISDIR(before.st_mode)) {
            // Restore traversal permission without following a swapped-in symlink.
            if (fchmodat(fd, name, 0700, AT_SYMLINK_NOFOLLOW)) { result = -1; continue; }
            int child = openat(fd, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
            if (child < 0) { result = -1; continue; }
            if (fstat(child, &opened) || before.st_dev != opened.st_dev || before.st_ino != opened.st_ino) {
                close(child); result = -1; continue;
            }
            if (clear_directory(child, depth + 1)) result = -1;
            close(child);
            if (unlinkat(fd, name, AT_REMOVEDIR)) result = -1;
        } else if (unlinkat(fd, name, 0)) result = -1;
    }
    closedir(stream);
    return result;
}
int zq_clear_job_directory(int fd) { return clear_directory(fd, 0); }
