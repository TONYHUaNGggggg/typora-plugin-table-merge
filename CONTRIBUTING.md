# Contributing

Thank you for helping improve Typora TableCraft.

## Before opening an issue

- Search existing issues.
- Confirm the problem still occurs after fully restarting Typora.
- State whether only `plugin.zip` is installed or the experimental macOS native bridge is also installed.
- Include the Typora version/build, operating system, community core version, and plugin version.
- Provide a minimal Markdown table that reproduces the problem. Remove private document content first.

## Development setup

Requirements: Node.js 22 and pnpm 11.

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm run typecheck
pnpm run build
```

For the macOS bridge, install Xcode Command Line Tools and run:

```bash
./native/macos/build.sh
./native/macos/build-launcher.sh
```

Test native changes only against a disposable copy of Typora before modifying a normal installation.

## Pull requests

1. Keep Markdown transformations in `src/table-model.ts` pure and covered by tests.
2. Add DOM behavior tests for changes to `src/merge-dom.ts`.
3. Preserve the invariants documented in `docs/ARCHITECTURE.md`.
4. Run tests, type checking, and the production build before submitting.
5. Update `CHANGELOG.md` when behavior visible to users changes.

Do not include a modified `Typora.app`, copied Typora binaries, private documents, or generated build directories in a pull request.
