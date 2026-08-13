# Typora Table Merge

[中文说明](README.zh-CN.md)

A community plugin that adds editable merged cells to native Typora Markdown tables without converting them into HTML blocks.

## Features

- Select a rectangular range with two Option/Alt-clicks.
- Merge 1×N, N×1, and multi-row/multi-column rectangles.
- Keep normal clicks, dragging, and ordinary right-click menus owned by Typora.
- Preserve the content of covered cells and restore it when unmerging.
- Use Typora's native undo and redo history.
- Render merged cells in the editor and export real HTML `rowspan`/`colspan`.
- Keep normal selections silent; notifications are reserved for invalid operations and errors.

## Usage

1. Hold Option on macOS or Alt on Windows/Linux and click the first corner cell.
2. Hold the same key and click the opposite corner cell.
3. Right-click inside the blue rectangle and choose **Merge selected cells**.
4. To unmerge, right-click a merged cell and choose **Unmerge**.

The plugin stores covered cell content in `::tmc-up:...::` and `::tmc-left:...::` markers inside the GFM table. The marker payload is hexadecimal-encoded so unmerge can restore the original content losslessly. The editor hides these implementation markers during normal use.

## Installation

Install [typora-community-plugin](https://github.com/typora-community-plugin/typora-community-plugin) first. Extract the release archive into its global plugin directory so the plugin folder directly contains:

```text
manifest.json
main.js
style.css
```

Then open **Plugin Settings → Installed Plugins** and enable **Table Merge**. Restart Typora after replacing plugin files because loaded JavaScript modules are cached for the lifetime of the app.

On macOS, installing the community plugin core modifies the Typora app bundle and invalidates the vendor signature. Review the community core's macOS installation instructions and keep a recoverable copy before modifying Typora.

## Development

Requirements: Node.js 22+ and pnpm 11.

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm run typecheck
pnpm run build
pnpm run pack
```

`pnpm run pack` creates `plugin.zip`.

## Tested environment

- macOS with Typora 1.14.9 (build 7785)
- typora-community-plugin core 2.9.14
- Editor rendering, save/reload, native undo/redo, and HTML export

## Limitations

- Only top-level GFM tables are mapped; nested tables inside lists or block quotes are not supported.
- A vertical merge cannot cross the header/body boundary.
- HTML export is tested. PDF, Word, and EPUB exports have not been individually verified.
- Typora's macOS native `NSMenu` cannot be extended from a web plugin, so the plugin menu appears only for an explicit blue selection or an existing merged cell.

## License

[MIT](LICENSE.md)
