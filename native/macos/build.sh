#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
output_dir="$script_dir/build"
mkdir -p "$output_dir"

xcrun clang \
  -fobjc-arc \
  -fblocks \
  -dynamiclib \
  -arch arm64 \
  -arch x86_64 \
  -mmacosx-version-min=11.0 \
  -framework AppKit \
  -framework Foundation \
  -framework WebKit \
  "$script_dir/TMNativeMenuBridge.m" \
  -o "$output_dir/TMNativeMenuBridge.dylib"

codesign --force --sign - "$output_dir/TMNativeMenuBridge.dylib"
file "$output_dir/TMNativeMenuBridge.dylib"
codesign --verify --strict --verbose=2 "$output_dir/TMNativeMenuBridge.dylib"
