#include <mach-o/dyld.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static int executable_directory(char *directory, size_t capacity) {
  char executable[PATH_MAX];
  uint32_t size = sizeof(executable);
  if (_NSGetExecutablePath(executable, &size) != 0) return -1;

  char resolved[PATH_MAX];
  if (!realpath(executable, resolved)) return -1;
  char *separator = strrchr(resolved, '/');
  if (!separator) return -1;
  *separator = '\0';

  if (strlen(resolved) + 1 > capacity) return -1;
  strcpy(directory, resolved);
  return 0;
}

int main(int argc, char **argv) {
  char directory[PATH_MAX];
  if (executable_directory(directory, sizeof(directory)) != 0) {
    fputs("Table Merge launcher: unable to locate the app executable directory.\n", stderr);
    return 70;
  }

  char original[PATH_MAX];
  char bridge[PATH_MAX];
  if (snprintf(original, sizeof(original), "%s/Typora.table-merge-original", directory) >=
          (int)sizeof(original) ||
      snprintf(bridge, sizeof(bridge), "%s/../Frameworks/TMNativeMenuBridge.dylib", directory) >=
          (int)sizeof(bridge)) {
    fputs("Table Merge launcher: an app path is too long.\n", stderr);
    return 70;
  }

  if (access(original, X_OK) != 0 || access(bridge, R_OK) != 0) {
    fputs("Table Merge launcher: the original executable or native bridge is missing.\n", stderr);
    return 66;
  }

  const char *existing = getenv("DYLD_INSERT_LIBRARIES");
  char libraries[PATH_MAX * 2];
  if (existing && existing[0] != '\0') {
    if (snprintf(libraries, sizeof(libraries), "%s:%s", bridge, existing) >=
        (int)sizeof(libraries)) {
      fputs("Table Merge launcher: DYLD_INSERT_LIBRARIES is too long.\n", stderr);
      return 70;
    }
  } else {
    strcpy(libraries, bridge);
  }
  if (setenv("DYLD_INSERT_LIBRARIES", libraries, 1) != 0) {
    perror("Table Merge launcher: setenv");
    return 71;
  }

  char **child_argv = calloc((size_t)argc + 1, sizeof(char *));
  if (!child_argv) return 71;
  child_argv[0] = original;
  for (int index = 1; index < argc; index++) child_argv[index] = argv[index];

  execv(original, child_argv);
  perror("Table Merge launcher: execv");
  free(child_argv);
  return 71;
}
