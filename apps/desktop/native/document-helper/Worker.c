// Executes only the bundled fixed document renderer, inheriting App Sandbox.
#include <sys/resource.h>
#include <unistd.h>
#include <stdlib.h>
#include <stdio.h>
#include <limits.h>
static void fail(const char *message) { fprintf(stderr, "document worker: %s\n", message); exit(125); }
static void limit(int kind, rlim_t maximum) {
    struct rlimit value = {maximum, maximum};
    if (setrlimit(kind, &value)) fail("setrlimit failed");
}
int main(int argc, char **argv) {
    if (argc != 3) fail("expected trusted resources and job paths");
    if (setpgid(0, 0) && getpgrp() != getpid()) fail("process group setup failed");
    limit(RLIMIT_CPU, 30); limit(RLIMIT_FSIZE, 64 * 1024 * 1024);
    limit(RLIMIT_NOFILE, 128); limit(RLIMIT_CORE, 0);
    // macOS does not reliably enforce RLIMIT_AS; do not claim a hard RAM cap.
    char resources[PATH_MAX], job[PATH_MAX], python[PATH_MAX], runner[PATH_MAX];
    if (!realpath(argv[1], resources) || !realpath(argv[2], job)) fail("invalid trusted path");
    snprintf(python, sizeof(python), "%s/python/bin/python3.12", resources);
    snprintf(runner, sizeof(runner), "%s/renderer.py", resources);
    char realpython[PATH_MAX];
    if (!realpath(python, realpython)) fail("bundled interpreter missing");
    if (chdir(job)) fail("job chdir failed");

    char *arguments[] = {realpython, "-I", "-B", runner, "request.json", NULL};
    char temp[PATH_MAX + 8]; snprintf(temp, sizeof(temp), "TMPDIR=%s", job);
    char *environment[] = {"PATH=/nonexistent", "LANG=en_US.UTF-8", "LC_ALL=en_US.UTF-8", temp, NULL};
    execve(realpython, arguments, environment);
    fail("bundled interpreter exec denied or unavailable");
}
