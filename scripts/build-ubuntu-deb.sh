#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

source_dir="${1:-dist-desktop/linux-unpacked}"
if [[ ! -d "$source_dir" ]]; then
  echo "Missing $source_dir. Run: npm run desktop:dist:linux (or electron-builder --linux dir) first." >&2
  exit 1
fi

version="$(
  sed -nE 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' package.json |
    head -n 1
)"
if [[ -z "$version" ]]; then
  echo "Could not read version from package.json" >&2
  exit 1
fi

output_path="dist-desktop/vibecoding-voice-${version}-ubuntu-amd64.deb"
build_root="$(mktemp -d "${TMPDIR:-/tmp}/vibecoding-voice-deb-root.XXXXXX")"
trap 'rm -rf "$build_root"' EXIT

mkdir -p \
  "$build_root/DEBIAN" \
  "$build_root/opt/vibecoding-voice" \
  "$build_root/usr/bin" \
  "$build_root/usr/share/applications" \
  "$build_root/usr/share/icons/hicolor/256x256/apps"

mkdir -p "$(dirname "$output_path")"
cp -a "${source_dir}/." "$build_root/opt/vibecoding-voice/"
cp build-assets/app-icon.png "$build_root/usr/share/icons/hicolor/256x256/apps/vibecoding-voice.png"

chmod 0755 "$build_root/opt/vibecoding-voice/@mac20777vibecoding-voice"
chmod 4755 "$build_root/opt/vibecoding-voice/chrome-sandbox" || true
ln -s /opt/vibecoding-voice/@mac20777vibecoding-voice "$build_root/usr/bin/vibecoding-voice"

cat > "$build_root/usr/share/applications/vibecoding-voice.desktop" <<EOF
[Desktop Entry]
Name=VibeCoding Voice
Comment=Voice-driven AI coding bridge
Exec=/opt/vibecoding-voice/@mac20777vibecoding-voice %U
Terminal=false
Type=Application
Icon=vibecoding-voice
Categories=Development;Utility;
StartupWMClass=VibeCoding Voice
EOF

cat > "$build_root/DEBIAN/control" <<EOF
Package: vibecoding-voice
Version: ${version}
Section: devel
Priority: optional
Architecture: amd64
Maintainer: mac20777
Depends: libc6 (>= 2.31), libgtk-3-0, libnotify4, libnss3, libxss1, libxtst6, xdg-utils, libatspi2.0-0, libuuid1, libsecret-1-0, libasound2t64 | libasound2, libgbm1
Recommends: xdotool, xclip, wtype
Description: Voice-driven AI coding bridge for ESP32 devices and desktop microphones.
 Captures push-to-talk audio, transcribes speech, and sends transcripts to Codex, Claude, or desktop text input.
EOF

dpkg-deb --build --root-owner-group "$build_root" "$output_path"
dpkg-deb --info "$output_path"
ls -lh "$output_path"
