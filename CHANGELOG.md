# Changelog

## 0.3.0

- Expand and shrink rectangular selections with Option/Alt + arrow keys.
- Insert or delete rows and columns without corrupting merged-cell structure.
- Copy, cut, and paste table regions while preserving complete merged cells.
- Show a boundary highlight and size badge when hovering a merged cell.
- Route structure and clipboard actions through Typora's native Table submenu on macOS when the experimental native bridge is loaded.
- Show merge and unmerge as mutually exclusive context actions and clear reused native-menu state between right clicks.
- Keep a merged cell visually merged while selected, and remove the temporary double-click expansion mode.
- Clear WebKit text-selection remnants so selected merged cells use one consistent highlight.
- Keep successful selection and editing operations silent; notify only on invalid operations or errors.

## 0.2.4

- Merge any continuous rectangular selection in a native Typora table.
- Select cells with two Option/Alt-clicks without taking over normal mouse actions.
- Preserve covered cell contents for lossless unmerge and native undo/redo.
- Render real `rowspan` and `colspan` in the editor and HTML exports.
- Keep Typora's normal context menu for ordinary table interactions.
- Hide persisted merge markers while selecting cells.
- Show notifications only for invalid operations and errors.
