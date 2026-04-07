#!/usr/bin/env bash
set -euo pipefail

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required but was not found on PATH." >&2
  echo "Install Homebrew first: https://brew.sh/" >&2
  exit 1
fi

install_formula() {
  local name="$1"
  if brew list --formula "$name" >/dev/null 2>&1; then
    echo "Formula already installed: $name"
    return
  fi
  echo "Installing formula: $name"
  brew install "$name"
}

install_cask() {
  local name="$1"
  if brew list --cask "$name" >/dev/null 2>&1; then
    echo "Cask already installed: $name"
    return
  fi
  echo "Installing cask: $name"
  brew install --cask "$name"
}

install_cask "makemkv"
install_formula "handbrake"
install_formula "ffmpeg"

echo
echo "Installed binary paths:"
command -v makemkvcon || true
command -v HandBrakeCLI || true
command -v ffprobe || true
