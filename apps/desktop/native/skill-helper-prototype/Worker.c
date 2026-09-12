// Development experiment: sandbox_init is deprecated. Failure is fatal; no fallback.
#include <sandbox.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <unistd.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <limits.h>
static void fail(const char *message) { fprintf(stderr, "worker: %s\n", message); exit(125); }
#ifndef APP_SANDBOX_ONLY_PROBE
static char *quote(const char *path) {
    char *out = calloc(strlen(path) * 2 + 3, 1), *p = out;
    if (!out) fail("allocation failed");
    *p++ = '"';
    for (; *path; path++) { if (*path == '\\' || *path == '"') *p++ = '\\'; *p++ = *path; }
    *p++ = '"'; return out;
}
#endif
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
    snprintf(runner, sizeof(runner), "%s/runner.py", resources);
    char realpython[PATH_MAX];
    if (!realpath(python, realpython)) fail("bundled interpreter missing");
    if (chdir(job)) fail("job chdir failed");
#ifndef APP_SANDBOX_ONLY_PROBE
    char *r = quote(resources), *j = quote(job), *p = quote(realpython), *profile = NULL;
    // Deny by default, including network, Mach services, fork and arbitrary exec.
    // The system read roots contain libraries, not user files; job is the sole write root.
    if (asprintf(&profile,
        "(version 1)\n(deny default)\n"
        // dyld's libignition opens / as an openat root on this macOS version.
        // Cryptex locations match the OS dyld-support.sb, without importing its broader rules.
        "(allow file-read* (literal \"/\") (subpath \"/System/Volumes/Preboot/Cryptexes/OS\") (subpath \"/System/Cryptexes/OS\"))\n"
        "(allow file-map-executable (subpath %s) (subpath \"/System/Library\") (subpath \"/usr/lib\") (subpath \"/System/Volumes/Preboot/Cryptexes/OS\") (subpath \"/System/Cryptexes/OS\"))\n"
        "(allow file-read* (subpath %s) (subpath %s) (subpath \"/System/Library\") (subpath \"/usr/lib\") (literal \"/dev/null\") (literal \"/dev/urandom\") (literal \"/dev/random\"))\n"
        "(allow file-read-metadata)\n"
        "(allow file-write* (subpath %s) (literal \"/dev/null\"))\n"
        "(allow process-exec (literal %s))\n"
        "(allow sysctl-read)\n", r, r, j, j, p) < 0) fail("profile allocation failed");
    char *error = NULL;
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    if (sandbox_init(profile, 0, &error)) {
        fprintf(stderr, "worker: restrictive sandbox initialization failed: %s\n", error ? error : "unknown");
        if (error) sandbox_free_error(error);
        return 125;
    }
#pragma clang diagnostic pop
    free(profile); free(r); free(j); free(p);
#endif
    char *arguments[] = {realpython, "-I", "-B", runner, "request.json", NULL};
    char temp[PATH_MAX + 8]; snprintf(temp, sizeof(temp), "TMPDIR=%s", job);
    char *environment[] = {"PATH=/nonexistent", "LANG=en_US.UTF-8", "LC_ALL=en_US.UTF-8", temp, NULL};
    execve(realpython, arguments, environment);
    fail("bundled interpreter exec denied or unavailable");
}
