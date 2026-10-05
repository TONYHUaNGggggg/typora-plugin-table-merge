#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
app_bundle="${1:?用法: ./native/macos/install-permanent.sh /path/to/Typora.app}"
macos_dir="$app_bundle/Contents/MacOS"
frameworks_dir="$app_bundle/Contents/Frameworks"
executable="$macos_dir/Typora"
original="$macos_dir/Typora.table-merge-original"
bridge_source="$script_dir/build/TMNativeMenuBridge.dylib"
launcher_source="$script_dir/build/TMInjectedLauncher"
bridge_destination="$frameworks_dir/TMNativeMenuBridge.dylib"

if [[ ! -d "$app_bundle" || ! -x "$executable" ]]; then
  print -u2 "找不到 Typora 应用或可执行文件: $app_bundle"
  exit 1
fi
if [[ ! -f "$bridge_source" || ! -x "$launcher_source" ]]; then
  print -u2 "缺少构建产物；请先运行 build.sh 和 build-launcher.sh"
  exit 1
fi

if [[ ! -e "$original" ]]; then
  mv "$executable" "$original"
elif cmp -s "$executable" "$launcher_source"; then
  print "检测到已有 Table Merge 启动器，将更新桥接和签名。"
else
  print -u2 "检测到原始可执行文件已备份，但当前启动入口不是本项目的启动器。"
  print -u2 "为避免覆盖未知修改，已停止安装。"
  exit 1
fi

install -m 0755 "$launcher_source" "$executable"
install -m 0755 "$bridge_source" "$bridge_destination"

codesign --force --deep --sign - "$app_bundle"
codesign --verify --deep --strict --verbose=2 "$app_bundle"

print "已永久嵌入 Table Merge 原生桥接: $app_bundle"
