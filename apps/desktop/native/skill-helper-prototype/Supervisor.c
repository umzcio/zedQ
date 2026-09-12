// Trusted development worker supervisor. Never evaluates skill code.
#include <sys/event.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <spawn.h>
#include <signal.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#include <limits.h>
extern int zq_clear_job_directory(int);
extern int zq_sample_job(int, int, uint64_t *, uint64_t *);
static volatile sig_atomic_t cancelled;
static void stop(int signal_number) { (void)signal_number; cancelled = 1; }
static double monotonic(void) {
    struct timespec t;
    if (clock_gettime(CLOCK_MONOTONIC, &t)) return -1;
    return t.tv_sec + t.tv_nsec / 1e9;
}
// Observe exit without releasing the PID. Kill its group before reaping so
// the group identifier cannot be reused between observation and termination.
static int reap_finished(pid_t *child, int *status) {
    siginfo_t info = {0};
    if (waitid(P_PID, (id_t)*child, &info, WEXITED | WNOHANG | WNOWAIT) < 0) return errno == EINTR ? 0 : -1;
    if (info.si_pid != *child) return 0;
    kill(-*child, SIGKILL);
    pid_t reaped;
    do { reaped = waitpid(*child, status, 0); } while (reaped < 0 && errno == EINTR);
    if (reaped != *child) return -1;
    *child = -1;
    return 1;
}
int main(int argc, char **argv) {
    if (argc != 5) return 125;
    // stdin is a duplicate of the service's locked file description. Keep it
    // until reap + cleanup, even when the service crashes. Never pass it to Python.
    struct stat lease;
    if (fstat(STDIN_FILENO, &lease) || !S_ISREG(lease.st_mode) || lease.st_uid != geteuid() || lease.st_nlink != 1 || (lease.st_mode & 077)) return 125;
    if (fcntl(STDIN_FILENO, F_SETFD, FD_CLOEXEC) == -1) return 125;
    if (setpgid(0, 0) && getpgrp() != getpid()) return 125;
    struct sigaction action = {0};
    action.sa_handler = stop; sigemptyset(&action.sa_mask);
    if (sigaction(SIGTERM, &action, NULL)) return 125;
    signal(SIGPIPE, SIG_IGN);
    // An orphaned stopped process group receives SIGHUP + SIGCONT. It must
    // resume into our parent-exit handling, not die before reaping its worker.
    signal(SIGHUP, SIG_IGN);
    const pid_t parent = (pid_t)strtol(argv[4], NULL, 10);
    const int root = open(argv[3], O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (root < 0) return 125;
    int result = 125, events = -1, status = 0;
    pid_t child = -1;
    // Register against the live parent before launching any untrusted work.
    // getppid checks on both sides prevent attachment to a recycled parent PID.
    if (parent <= 1 || getppid() != parent) goto cleanup;
    events = kqueue();
    if (events < 0 || fcntl(events, F_SETFD, FD_CLOEXEC) == -1) goto cleanup;
    struct kevent change;
    EV_SET(&change, parent, EVFILT_PROC, EV_ADD | EV_ENABLE, NOTE_EXIT, 0, NULL);
    if (kevent(events, &change, 1, NULL, 0, NULL) < 0 || getppid() != parent || cancelled) goto cleanup;
    posix_spawnattr_t attributes;
    if (posix_spawnattr_init(&attributes)) goto cleanup;
    // Separate child group lets cancellation spare the supervisor and its lease.
    int error = posix_spawnattr_setflags(&attributes, POSIX_SPAWN_SETPGROUP);
    if (!error) error = posix_spawnattr_setpgroup(&attributes, 0);
    posix_spawn_file_actions_t files;
    int file_error = posix_spawn_file_actions_init(&files);
    const int files_initialized = !file_error;
    if (!file_error) file_error = posix_spawn_file_actions_addopen(&files, STDIN_FILENO, "/dev/null", O_RDONLY, 0);
    char *arguments[] = {argv[1], argv[2], argv[3], NULL};
    char *environment[] = {NULL};
    if (!error && !file_error) error = posix_spawn(&child, argv[1], &files, &attributes, arguments, environment);
    if (files_initialized) posix_spawn_file_actions_destroy(&files);
    posix_spawnattr_destroy(&attributes);
    if (error || file_error) goto cleanup;
    const double start = monotonic();
    double next_sample = start;
    result = 0;
    for (;;) {
        int finished = reap_finished(&child, &status);
        if (finished == 1) { result = WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status); break; }
        if (finished < 0) { result = 125; break; }
        const double now = monotonic();
        if (cancelled || getppid() != parent) { result = 130; break; }
        if (start < 0 || now < 0 || now - start >= 30) { result = 124; break; }
#ifdef SEATBELT_ONLY_PROBE
        if (now >= next_sample) {
            uint64_t memory = 0, bytes = 0;
            int sample = zq_sample_job(child, root, &memory, &bytes);
            if (sample) {
                // The process may exit between waitpid and the resource query.
                if (sample == -1 && reap_finished(&child, &status) == 1) {
                    result = WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status); break;
                }
                result = sample > 0 ? 119 + sample : 123; break;
            }
            next_sample = now + .05;
        }
#else
        (void)next_sample;
#endif
        struct kevent event;
        struct timespec timeout = {0, 10000000};
        int count = kevent(events, NULL, 0, &event, 1, &timeout);
        if (count > 0 || (count < 0 && errno != EINTR)) { result = 130; break; }
    }
cleanup:
    if (child > 0) {
        kill(-child, SIGKILL); kill(child, SIGKILL);
        while (waitpid(child, &status, 0) < 0 && errno == EINTR) {}
    }
#ifdef SEATBELT_ONLY_PROBE
    if (result == 0) {
        uint64_t memory = 0, bytes = 0;
        int sample = zq_sample_job(0, root, &memory, &bytes);
        if (sample) result = sample > 0 ? 119 + sample : 123;
    }
#endif
    if (events >= 0) close(events);
    if (zq_clear_job_directory(root) || rmdir(argv[3])) result = 126;
    close(root);
    close(STDIN_FILENO); // Last lease duplicate only after cleanup.
    return result;
}
