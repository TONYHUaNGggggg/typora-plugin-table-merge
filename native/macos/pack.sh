#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
project_root="${script_dir:h:h}"
version="${1:?用法: ./native/macos/pack.sh VERSION}"
archive_name="typora-tablecraft-macos-native-${version}.zip"
staging_root="$(mktemp -d "${TMPDIR:-/tmp}/typora-tablecraft-release.XXXXXX")"
package_root="$staging_root/typora-tablecraft-macos-native-${version}"

cleanup() {
  rm -rf "$staging_root"
}
trap cleanup EXIT

if [[ ! -f "$script_dir/build/TMNativeMenuBridge.dylib" || ! -x "$script_dir/build/TMInjectedLauncher" ]]; then
  print -u2 "缺少构建产物；请先运行 build.sh 和 build-launcher.sh"
  exit 1
fi

mkdir -p "$package_root/native/macos/build"
install -m 0755 "$script_dir/build/TMNativeMenuBridge.dylib" "$package_root/native/macos/build/"
install -m 0755 "$script_dir/build/TMInjectedLauncher" "$package_root/native/macos/build/"
install -m 0755 "$script_dir/install-permanent.sh" "$package_root/native/macos/"
install -m 0755 "$script_dir/uninstall-permanent.sh" "$package_root/native/macos/"
install -m 0644 "$script_dir/README.zh-CN.md" "$package_root/native/macos/"
install -m 0644 "$project_root/LICENSE.md" "$package_root/"

rm -f "$project_root/$archive_name"
(cd "$staging_root" && /usr/bin/zip -q -r -X "$project_root/$archive_name" "${package_root:t}")
print "已生成: $project_root/$archive_name"
