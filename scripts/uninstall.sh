#!/usr/bin/env bash
set -euo pipefail

BEGIN_MARKER="-- BEGIN omarchy-scripts"
END_MARKER="-- END omarchy-scripts"
REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

hypr_bindings_lua_file() {
  printf '%s\n' "${HYPR_BINDINGS_LUA_FILE:-$HOME/.config/hypr/bindings.lua}"
}

strip_existing_bindings() {
  local file="$1"

  awk -v begin="$BEGIN_MARKER" -v end="$END_MARKER" '
    $0 == begin { skip = 1; next }
    $0 == end { skip = 0; next }
    skip { next }
    { print }
  ' "$file"
}

trim_trailing_blank_lines() {
  awk '
    NF { last = NR }
    { lines[NR] = $0 }
    END { for (i = 1; i <= last; i++) print lines[i] }
  '
}

backup_bindings_file() {
  local file="$1"

  [[ -s "$file" ]] || return
  cp "$file" "$file.bak.omarchy-scripts-$(date +'%Y%m%d%H%M%S')"
}

uninstall_bindings() {
  local file tmp

  file=$(hypr_bindings_lua_file)
  [[ -f "$file" ]] || return
  backup_bindings_file "$file"
  tmp=$(mktemp)
  strip_existing_bindings "$file" | trim_trailing_blank_lines >"$tmp"
  cat "$tmp" >"$file"
  rm -f "$tmp"
}

reload_hyprland() {
  command -v hyprctl >/dev/null || return
  hyprctl reload >/dev/null 2>&1 || return 0
  hyprctl configerrors
}

alacritty_fragment_file() {
  printf '%s\n' "${ALACRITTY_FRAGMENT_FILE:-$HOME/.config/alacritty/omarchy-scripts.toml}"
}

hint_command_file() {
  printf '%s\n' "${OPEN_TERMINAL_HINT_FILE:-$HOME/.local/bin/omarchy-open-terminal-hint}"
}

remove_managed_symlink() {
  local source="$1"
  local target="$2"

  [[ -L "$target" ]] || return
  if [[ "$(readlink -f "$target")" != "$(readlink -f "$source")" ]]; then
    printf 'Preserved unrelated symlink: %s\n' "$target" >&2
    return
  fi
  unlink "$target"
}

uninstall_alacritty_config() {
  remove_managed_symlink "$REPO_ROOT/config/alacritty/omarchy-scripts.toml" "$(alacritty_fragment_file)"
  remove_managed_symlink "$REPO_ROOT/src/omarchy-open-terminal-hint.ts" "$(hint_command_file)"
}

main() {
  uninstall_bindings
  uninstall_alacritty_config
  reload_hyprland
  printf 'Uninstalled omarchy-scripts keybindings and personal configurations.\n'
}

main "$@"
