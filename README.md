<div align="center">

# Typora Table Merge

**Editable, reversible, persistent merged cells for native Typora Markdown tables.**

[![CI](https://github.com/TONYHUaNGggggg/typora-plugin-table-merge/actions/workflows/ci.yml/badge.svg)](https://github.com/TONYHUaNGggggg/typora-plugin-table-merge/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/TONYHUaNGggggg/typora-plugin-table-merge?display_name=tag)](https://github.com/TONYHUaNGggggg/typora-plugin-table-merge/releases/latest)
[![License](https://img.shields.io/github/license/TONYHUaNGggggg/typora-plugin-table-merge)](LICENSE.md)
[![Typora](https://img.shields.io/badge/Typora-1.14.9-476582)](#compatibility)

[中文说明](README.zh-CN.md) · [Quick start](#quick-start) · [Usage](#usage) · [Native menu](#native-macos-menu) · [FAQ](#faq)

</div>

---

Typora Table Merge adds merged cells without turning your table into a hard-to-edit HTML block. The file remains a normal GFM Markdown table, the editor displays real merged cells, and HTML export emits standard `rowspan` and `colspan` attributes.

## Highlights

| Capability | Behavior |
| --- | --- |
| Rectangular selection | Option/Alt-click two corners; supports 1×N, N×1, and arbitrary rectangles |
| Keyboard adjustment | Option/Alt + arrow keys expands or shrinks; Escape clears |
| Merge and unmerge | Covered cell contents are preserved and restored losslessly |
| Structural editing | Row/column insertion and deletion expands, shrinks, or shifts merges safely |
| Region clipboard | Copy, cut, and paste rectangular regions while retaining merged structure |
| Rendering and export | Clean editor rendering and real HTML `rowspan` / `colspan` output |
| Native undo | Content changes participate in Typora's undo/redo history |
| System menu | An experimental macOS bridge adds commands to Typora's native Table submenu |

## Quick start

1. Install [`typora-community-plugin`](https://github.com/typora-community-plugin/typora-community-plugin).
2. Download `plugin.zip` from the [latest release](https://github.com/TONYHUaNGggggg/typora-plugin-table-merge/releases/latest).
3. Extract it into the community core's global plugin directory so the plugin folder directly contains `manifest.json`, `main.js`, and `style.css`.
4. Open **Plugin Settings → Installed Plugins**, enable **Table Merge**, then fully quit and reopen Typora.

The verified macOS path is:

```text
~/Library/Application Support/abnerworks.Typora/plugins/plugins/tonyhuang.table-merge/
```

Installing the community core on macOS modifies the Typora app bundle and invalidates its vendor signature. Keep a recoverable backup and follow the core project's macOS instructions.

## Usage

1. Hold Option on macOS or Alt on Windows/Linux and click the first corner cell.
2. Hold the same key and click the opposite corner.
3. Right-click the blue rectangle and choose **Merge selected cells** from **Table**.
4. Right-click a merged cell and choose **Unmerge cells** to restore its original contents.

After setting the first corner, Option/Alt + arrow keys moves the other corner, expanding or shrinking the rectangle. Escape clears the selection. Normal clicks, text selection, and mouse dragging remain fully owned by Typora.

Copy and cut require every intersecting merged cell to be selected in full. Paste into an equally sized rectangle, or select a single destination cell to use it as the top-left corner. Merge relationships inside the region are copied too.

When a row or column operation intersects a merge, the plugin preserves structure: inserts inside expand the merge, deletions inside shrink it, and external edits shift or leave it unchanged.

## Native macOS menu

A web plugin cannot directly extend macOS `NSMenu`. This repository also ships an experimental native bridge that inserts context-sensitive merge/unmerge and region clipboard commands into Typora's existing **Table** submenu. It also reroutes row/column operations when required to protect merged structure.

> [!WARNING]
> The bridge modifies `Typora.app`, hooks private implementation details, and ad-hoc signs the resulting bundle. It is not an official Typora API and is currently verified only with Typora 1.14.9 (build 7785) on macOS. Back up the app first; a Typora update will usually require reinstalling the bridge.

Download `typora-table-merge-macos-native-<version>.zip`, extract it, fully quit Typora, and run:

```bash
ditto "/Applications/Typora.app" "$HOME/Desktop/Typora-before-table-merge.app"
./native/macos/install-permanent.sh "/Applications/Typora.app"
```

To remove the bridge and restore the original executable:

```bash
./native/macos/uninstall-permanent.sh "/Applications/Typora.app"
```

See the [native bridge guide](native/macos/README.zh-CN.md) for source builds and isolated testing.

## Storage and export

The GFM table remains the source of truth. Covered cells contain `::tmc-up:...::` or `::tmc-left:...::` markers whose hexadecimal payload stores the original cell source. The editor hides these markers, unmerge restores them losslessly, and HTML export removes covered cells while emitting standard span attributes.

## Compatibility

| Environment | Web plugin | Native system menu |
| --- | --- | --- |
| macOS, Typora 1.14.9 build 7785 | Verified | Verified |
| Windows | Not yet tested on hardware | Not supported; requires a separate native bridge |
| Linux | Not yet tested on hardware | Not supported |

Editor rendering, reload, undo/redo, structural editing, region clipboard operations, and HTML export are covered. PDF, Word, and EPUB export have not been individually verified.

## FAQ

**The selection works, but the native Table menu has no merge command.**

The web plugin is active but the native bridge is not loaded. Install the native release package and fully restart Typora. Without it, the plugin uses its web-menu fallback.

**I can see `::tmc-...::` in the table.**

The plugin is disabled, failed to load, or Typora has not been restarted. Do not edit the markers manually; check Plugin Settings and restart.

**Commands disappeared after a Typora update.**

Updates may replace both the community core integration and the native bridge. Re-enable the web plugin and install a bridge version verified against the new Typora build.

## Current limitations

- Only top-level GFM tables are mapped; nested tables in lists or block quotes are not supported.
- A vertical merge cannot cross the header/body boundary.
- HTML export is verified; other export formats depend on Typora's export pipeline.
- The native bridge relies on a private Objective-C class and may need adaptation after updates.

## Development

Requirements: Node.js 22, pnpm 11, and Xcode Command Line Tools for the native bridge.

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm run typecheck
pnpm run build
pnpm run pack
```

```bash
./native/macos/build.sh
./native/macos/build-launcher.sh
./native/macos/pack.sh 0.3.0
```

See [Architecture](docs/ARCHITECTURE.md), [Contributing](CONTRIBUTING.md), and the [Changelog](CHANGELOG.md).

## License

[MIT](LICENSE.md) © Tony Huang
