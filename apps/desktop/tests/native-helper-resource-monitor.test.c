#include <errno.h>
#include <fcntl.h>
#include <ftw.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/stat.h>
#include <unistd.h>

int zq_sample_job(int pid, int rootfd, uint64_t *memory_bytes, uint64_t *file_bytes);

static char fixture[] = "/tmp/zq-resource-monitor-XXXXXX";
static int failures;

static int remove_entry(const char *path, const struct stat *st, int type,
                        struct FTW *walk) {
    (void)st; (void)type; (void)walk;
    return remove(path);
}

static void cleanup(void) {
    nftw(fixture, remove_entry, 16, FTW_DEPTH | FTW_PHYS);
}

static void require(int condition, const char *message) {
    if (!condition) { perror(message); exit(1); }
}

static void check(int condition, const char *message) {
    if (!condition) { fprintf(stderr, "FAIL: %s\n", message); failures++; }
}

static int directory(int parent, const char *name) {
    require(mkdirat(parent, name, 0700) == 0, "mkdirat fixture");
    int fd = openat(parent, name, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    require(fd >= 0, "open fixture directory");
    return fd;
}

static void sized_file(int parent, const char *name, off_t size) {
    int fd = openat(parent, name, O_CREAT | O_WRONLY | O_TRUNC | O_CLOEXEC, 0600);
    require(fd >= 0, "create fixture file");
    require(ftruncate(fd, size) == 0, "size fixture file");
    close(fd);
}

int main(void) {
    require(mkdtemp(fixture) != NULL, "mkdtemp");
    atexit(cleanup);
    int root = open(fixture, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    require(root >= 0, "open fixture root");
    uint64_t memory = 0, bytes = 0;

    int files = directory(root, "files");
    sized_file(files, "one", 17);
    int nested = directory(files, "nested");
    sized_file(nested, "two", 23);
    close(nested);
    check(zq_sample_job(getpid(), files, &memory, &bytes) == 0 && bytes == 40,
          "adds logical sizes in nested directories");
    check(memory > 0, "samples real process memory");
    check(zq_sample_job(0, files, &memory, &bytes) == 0 && memory == 0 && bytes == 40,
          "pid zero samples files after process exit and clears memory output");
    sized_file(files, "three", 7);
    check(zq_sample_job(getpid(), files, &memory, &bytes) == 0 && bytes == 47,
          "repeated sampling starts with an independent directory offset");
    close(files);

    int links = directory(root, "links");
    int outside = directory(root, "outside");
    sized_file(outside, "large", 67108865);
    close(outside);
    require(symlinkat("../outside", links, "directory-link") == 0, "symlink directory");
    require(symlinkat("../outside/large", links, "file-link") == 0, "symlink file");
    require(symlinkat("missing", links, "broken-link") == 0, "symlink missing");
    require(mkfifoat(links, "fifo", 0600) == 0, "fifo fixture");
    check(zq_sample_job(getpid(), links, &memory, &bytes) == 0 && bytes == 0,
          "does not follow symlinks or open special files");
    close(links);

    int quota = directory(root, "quota");
    sized_file(quota, "sparse", 67108864);
    check(zq_sample_job(getpid(), quota, &memory, &bytes) == 0 && bytes == 67108864,
          "allows exactly 64 MiB of logical file size");
    sized_file(quota, "extra", 1);
    check(zq_sample_job(getpid(), quota, &memory, &bytes) == 2 && bytes > 67108864,
          "rejects total logical file size over 64 MiB including sparse files");
    close(quota);

    int nodes = directory(root, "nodes");
    for (int i = 0; i < 4096; ++i) {
        char name[24];
        snprintf(name, sizeof(name), "n%d", i);
        sized_file(nodes, name, 0);
    }
    check(zq_sample_job(getpid(), nodes, &memory, &bytes) == 0,
          "allows 4096 descendant nodes");
    require(symlinkat("missing", nodes, "overflow") == 0, "node overflow fixture");
    check(zq_sample_job(getpid(), nodes, &memory, &bytes) == 3,
          "rejects node 4097 even when it is a symlink");
    close(nodes);

    int deep = directory(root, "deep");
    int cursor = dup(deep);
    require(cursor >= 0, "dup depth fixture");
    for (int i = 0; i < 64; ++i) {
        int next = directory(cursor, "d");
        close(cursor);
        cursor = next;
    }
    check(zq_sample_job(getpid(), deep, &memory, &bytes) == 0,
          "allows directory depth 64 below the root");
    sized_file(cursor, "too-deep", 0);
    check(zq_sample_job(getpid(), deep, &memory, &bytes) == 3,
          "rejects an entry at depth 65");
    close(cursor);
    close(deep);

    int unreadable = directory(root, "unreadable");
    int locked = directory(unreadable, "locked");
    require(fchmod(locked, 0000) == 0, "lock fixture");
    if (geteuid() != 0) {
        check(zq_sample_job(getpid(), unreadable, &memory, &bytes) == -1,
              "fails closed on unreadable directories");
        struct stat st;
        require(fstat(locked, &st) == 0, "inspect locked fixture");
        check((st.st_mode & 0777) == 0, "does not change directory permissions");
    }
    require(fchmod(locked, 0700) == 0, "restore fixture for cleanup");
    close(locked);
    close(unreadable);

    check(zq_sample_job(getpid(), -1, &memory, &bytes) == -1,
          "fails closed on invalid directory descriptor");
    check(zq_sample_job(-1, root, &memory, &bytes) == -1,
          "fails closed on invalid process identifier");
    check(zq_sample_job(getpid(), root, NULL, &bytes) == -1,
          "rejects null output pointer");
    close(root);
    if (failures) return 1;
    puts("native resource monitor: all tests passed");
    return 0;
}
