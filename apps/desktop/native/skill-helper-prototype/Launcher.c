// The bundle entry point forwards to a separately signed caller executable.
// This keeps its CDHash stable while the outer app seals the embedded service.
#include <mach-o/dyld.h>
#include <limits.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
int main(int argc, char **argv) {
    (void)argc;
    char path[PATH_MAX];
    uint32_t size = sizeof(path);
    if (_NSGetExecutablePath(path, &size)) return 125;
    char *leaf = strrchr(path, '/');
    if (!leaf || (size_t)(leaf - path) + sizeof("/SkillHelperPrototype") > sizeof(path)) return 125;
    strcpy(leaf, "/SkillHelperPrototype");
    argv[0] = path;
    execv(path, argv);
    perror("caller launch failed");
    return 125;
}
