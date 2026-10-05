# macOS 原生右键菜单桥接（实验性）

这个目录验证了一条纯网页插件无法实现、但原生代码可以实现的路径：在 Typora 构造系统 `NSMenu` 时，将插件的合并/取消合并和复制/剪切/粘贴动作追加到原生“表格”子菜单，并把点击动作转发给社区插件。当表格已包含合并标记时，桥接还会将 Typora 原有的插入/删除行列命令重定向到结构安全的插件实现。

它不是 Typora 官方扩展接口。实现会挂钩 Typora 的私有 Objective-C 类 `ContextMenuCommands`，因此可能随 Typora 更新失效。目前只在 macOS、Typora 1.14.9（build 7785）验证；Windows 需要单独实现 DLL/原生菜单挂钩，不能直接复用这个 dylib。

## 构建

```bash
./native/macos/build.sh
```

产物为 `native/macos/build/TMNativeMenuBridge.dylib`，同时包含 Apple Silicon 和 Intel 架构，并使用临时签名。

从仓库源码安装永久桥接时，还需要生成通用架构启动器：

```bash
./native/macos/build-launcher.sh
```

GitHub Release 中的 `typora-table-merge-macos-native-<版本>.zip` 已经包含这两个通用架构二进制文件，无需本地编译。

## 隔离测试

请只对测试副本使用，不要直接修改 `/Applications/Typora.app`。测试副本中仍需已经安装并启用社区插件核心和本插件。

```bash
./native/macos/run-test.sh \
  "/path/to/Typora-TableMerge-Test.app" \
  "$(pwd)/native/macos/native-menu-test.md"
```

验证方法：

1. 右键已有合并单元格，打开 Typora 原生的“表格”子菜单，点击“取消合并单元格”。
2. 对普通单元格，按住 Option 依次点击矩形两个对角，再从同一原生子菜单选择“合并所选单元格”。
3. 选中完整合并区域后，使用“复制所选区域”或“剪切所选区域”；在另一个单元格上右键，使用“粘贴表格区域”。
4. 在含合并单元格的表格中，点击原菜单的“在上方/下方插入行”、“在左侧/右侧插入列”或删除行列，确认合并区域会正确扩展、收缩或平移。

桥接是启动时注入，不会把 dylib 写进 `.app`。但若把同样机制永久嵌入正式应用，仍会涉及应用签名、Gatekeeper 以及每个 Typora 版本的兼容性维护。

## 永久嵌入

永久安装会把原始主程序保存在 `Contents/MacOS/Typora.table-merge-original`，安装一个很小的通用架构启动器，并把桥接库放入 `Contents/Frameworks`。启动器在每次正常打开 Typora 时自动加载桥接；安装完成后会对整个应用重新进行临时签名。

先完全退出 Typora，并备份完整应用：

```bash
ditto "/Applications/Typora.app" "$HOME/Desktop/Typora-before-table-merge.app"
```

从源码安装：

```bash
./native/macos/build.sh
./native/macos/build-launcher.sh
./native/macos/install-permanent.sh "/Applications/Typora.app"
```

从 GitHub Release 压缩包安装时，解压后直接执行其中的安装脚本即可，不需要再次运行两个构建脚本。

移除桥接并恢复安装前的主程序：

```bash
./native/macos/uninstall-permanent.sh "/Applications/Typora.app"
```

Typora 更新通常会覆盖永久嵌入内容，需要重新安装。操作前应完整备份当前应用；安装或移除后需要彻底退出并重新打开 Typora。

安装脚本只在首次安装时移动原始可执行文件；若已经存在备份但当前入口不是本项目启动器，脚本会停止，避免覆盖其他修改。卸载脚本会恢复原始主程序、删除桥接库，然后重新签名和验证应用。
