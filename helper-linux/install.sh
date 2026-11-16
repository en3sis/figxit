#!/bin/bash
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd -P)
out=$root/dist/linux/Figxit.app
dest=${FIGXIT_PREFIX:-$HOME/.local/lib/figxit}/Figxit.app
PATH="$HOME/.bun/bin:$PATH"

build() {
  if ! command -v bun >/dev/null; then
    echo "install.sh: bun is needed to build the engine, see https://bun.sh" >&2
    exit 1
  fi
  local build=$root/helper-linux/build-release
  cmake -S "$root/helper-linux" -B "$build" -DCMAKE_BUILD_TYPE=Release >/dev/null
  cmake --build "$build" --target figxit-helper
  (cd "$root/engine" && bun install --frozen-lockfile >/dev/null)
  rm -rf "$out"
  mkdir -p "$out/Contents/MacOS" "$out/Contents/Resources"
  cp "$build/figxit-helper" "$out/Contents/MacOS/figxit-helper"
  (cd "$root/engine" && bun build --compile src/main.ts --outfile "$out/Contents/MacOS/figxit-engine" >/dev/null)
  rsync -a --delete "$root/engine/node_modules/@withfig/autocomplete/build/" "$out/Contents/Resources/specs/"
  rsync -a --delete --include='*/' --include='*.zsh' --include='*.bash' --include='*.fish' --exclude='*' \
    "$root/shell/" "$out/Contents/Resources/shell/"
  echo "built $out"
}

stop() {
  pkill -x figxit-helper 2>/dev/null || true
  pkill -x figxit-engine 2>/dev/null || true
}

install() {
  mkdir -p "$(dirname "$dest")"
  rm -rf "$dest.new"
  cp -a "$out" "$dest.new"
  stop
  rm -rf "$dest"
  mv "$dest.new" "$dest"
  echo "installed $dest"
  add_to_bashrc
}

add_to_bashrc() {
  local rc=$HOME/.bashrc
  local line="eval \"\$('$dest/Contents/MacOS/figxit-engine' init bash)\""
  if grep -qsF "$line" "$rc"; then
    echo "~/.bashrc already loads Figxit. Open a new terminal to use the new version."
    return
  fi
  local answer=n
  if [ -t 0 ]; then
    read -r -p "Add the line that loads Figxit to ~/.bashrc? [Y/n] " answer
    answer=${answer:-y}
  fi
  case $answer in
    [Yy]*)
      printf '\n# Figxit\n%s\n' "$line" >>"$rc"
      echo "Added to ~/.bashrc. Open a new terminal to use Figxit."
      ;;
    *)
      echo
      echo "Add this line to ~/.bashrc, then open a new terminal:"
      echo
      echo "  $line"
      ;;
  esac
}

uninstall() {
  stop
  rm -rf "$dest"
  echo "removed $dest"
  echo "Remove the line with figxit-engine from ~/.bashrc, if there is one."
}

case "${1:-}" in
  "")
    build
    install
    ;;
  --build) build ;;
  --uninstall) uninstall ;;
  *)
    echo "Usage: install.sh [--build | --uninstall]" >&2
    exit 1
    ;;
esac
