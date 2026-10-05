#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
app_bundle="${1:?用法: ./native/macos/run-test.sh /path/to/Typora-Test.app [document.md]}"
document_path="${2:-$script_dir/native-menu-test.md}"
executable="$app_bundle/Contents/MacOS/Typora"
bridge="$script_dir/build/TMNativeMenuBridge.dylib"

if [[ ! -x "$executable" ]]; then
  print -u2 "找不到 Typora 可执行文件: $executable"
  exit 1
fi

if [[ ! -f "$bridge" ]]; then
  print -u2 "找不到原生桥接库；请先运行 ./native/macos/build.sh"
  exit 1
fi

exec env DYLD_INSERT_LIBRARIES="$bridge" "$executable" "$document_path"
