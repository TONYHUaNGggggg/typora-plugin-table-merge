# Typora 原生表格合并插件

这是一个基于 [`typora-community-plugin`](https://github.com/typora-community-plugin/typora-community-plugin) 的插件。在不把表格转换成 HTML Block 的前提下，为 Typora 原生 Markdown 表格增加可编辑、可撤销、可保存、可导出的合并单元格。

## 工作方式

- Markdown 文件仍保存为普通 GFM 表格。
- 被覆盖单元格保存为 `::tmc-up:...::` 或 `::tmc-left:...::` 纯文本标记；十六进制内容用于无损取消合并。
- `tmc` 中以十六进制保存原单元格源码，取消合并时可以无损恢复。
- 编辑器后处理器把标记渲染成 `rowspan` / `colspan`。
- 导出处理器删除覆盖单元格并输出真正的 HTML 合并表格。
- 修改通过 Typora 的 `File.reloadContent()` 完成，进入 Typora 原生撤销/重做栈。

## 使用

1. 按住 Option（Windows/Linux 为 Alt）点击一个单元格设置起点，再按住 Option/Alt 点击另一个单元格设置终点；插件会选择两点之间的完整矩形区域，可一次合并 1×3、2×2、3×2 等任意数量的单元格。
2. 只有在蓝色多选区域内或插件生成的已合并单元格上右键时，才打开合并菜单；普通未合并单元格的右键完全使用 Typora 原来的系统菜单。
3. 点击菜单顶部的“合并所选单元格（行×列）”。
4. 取消合并时，右键合并后的单元格，再点击“取消合并”。
5. 双击合并后的单元格，可以暂时展开底层原生表格；点击表格外部恢复合并预览。

普通点击和鼠标拖动完全交给 Typora，不会触发单元格选择；重新选择时再次按住 Option/Alt 点击新的起点和终点。

正常选择、合并成功和取消合并成功均保持静默；只有选择非法、无法执行或发生错误时才在右下角提示。Alt/Option 选择期间会隐藏底层持久化标记，不影响表格行高和布局。

快速合并相邻单元格时，也可以先把光标放入单元格，再执行“表格：当前单元格与下方单元格合并”或“表格：当前单元格与右侧单元格合并”。

## 开发

```bash
pnpm install
pnpm test
pnpm run typecheck
pnpm run build
pnpm run pack
```

`plugin.zip` 是可分发包。请先安装社区插件核心。手动安装时，把压缩包内容解压到社区插件核心的全局插件目录下，并保证目录内直接包含 `manifest.json`、`main.js` 和 `style.css`，然后在“插件设置 → 已安装插件”中启用 Table Merge。覆盖插件文件后需要完整退出并重新打开 Typora，因为已加载的 JavaScript 模块会在应用生命周期内缓存。

## 已验证环境

- macOS、Typora 1.14.9（build 7785）
- typora-community-plugin core 2.9.14
- 首屏合并渲染、原生表格快捷合并、保存后重新载入
- Typora 原生撤销与重做
- HTML 导出生成真实 `rowspan` / `colspan`，且不包含持久化标记

macOS 上安装社区插件核心需要修改 `Typora.app`，这会破坏厂商签名。操作前请参考社区核心的 macOS 安装说明并保留可恢复副本。

macOS 的系统右键菜单（`NSMenu`）项目由 Typora 原生层固定生成，网页插件不能追加项目。本插件因此只在已经通过 Option/Alt 形成蓝色多选区域时显示同风格菜单，并让其中的增删行列等命令直接调用 Typora 自己的 `editor.tableEdit` 接口。普通表格右键不拦截，仍显示 Typora 原生菜单。

## 发布版本

当前版本：`0.2.4`。版本变更见 [CHANGELOG.md](CHANGELOG.md)。

## 当前边界

- 暂时只映射顶层 GFM 表格；引用块、列表内部的嵌套表格还未支持。
- 不允许纵向合并跨越表头和正文。
- HTML 导出已经实机验证；PDF、Word、Epub 等格式尚未逐项验证。
- 普通表格不经过合并 DOM 后处理，避免干扰 Typora 原生的插入表格流程。
