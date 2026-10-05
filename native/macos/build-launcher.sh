#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
build_dir="$script_dir/build"
source_file="$script_dir/TMInjectedLauncher.c"

mkdir -p "$build_dir"

clang -arch arm64 -mmacosx-version-min=11.0 \
  "$source_file" -o "$build_dir/TMInjectedLauncher-arm64"
clang -arch x86_64 -mmacosx-version-min=11.0 \
  "$source_file" -o "$build_dir/TMInjectedLauncher-x86_64"
lipo -create \
  "$build_dir/TMInjectedLauncher-arm64" \
  "$build_dir/TMInjectedLauncher-x86_64" \
  -output "$build_dir/TMInjectedLauncher"
codesign --force --sign - "$build_dir/TMInjectedLauncher"

file "$build_dir/TMInjectedLauncher"
codesign --verify --strict --verbose=2 "$build_dir/TMInjectedLauncher"
