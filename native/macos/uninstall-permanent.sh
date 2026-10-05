#!/bin/zsh
set -euo pipefail

app_bundle="${1:?用法: ./native/macos/uninstall-permanent.sh /path/to/Typora.app}"
macos_dir="$app_bundle/Contents/MacOS"
executable="$macos_dir/Typora"
original="$macos_dir/Typora.table-merge-original"
bridge="$app_bundle/Contents/Frameworks/TMNativeMenuBridge.dylib"

if [[ ! -x "$original" ]]; then
  print -u2 "找不到备份的原始 Typora 可执行文件: $original"
  exit 1
fi

mv "$original" "$executable"
rm -f "$bridge"
codesign --force --deep --sign - "$app_bundle"
codesign --verify --deep --strict --verbose=2 "$app_bundle"

print "已移除 TableCraft 原生桥接: $app_bundle"
