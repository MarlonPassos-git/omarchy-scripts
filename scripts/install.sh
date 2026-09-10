#!/usr/bin/env bash
set -euo pipefail

BEGIN_MARKER="-- BEGIN omarchy-scripts"
END_MARKER="-- END omarchy-scripts"
REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
MANIFEST="$REPO_ROOT/src/manifest.tsv"
ALACRITTY_IMPORT="~/.config/alacritty/omarchy-scripts.toml"

hypr_bindings_lua_file() {
  printf '%s\n' "${HYPR_BINDINGS_LUA_FILE:-$HOME/.config/hypr/bindings.lua}"
}

display_path() {
  local path="$1"
  local home_prefix="$HOME/"

  if [[ "$path" == "$home_prefix"* ]]; then
    printf '~/%s\n' "${path#"$home_prefix"}"
    return
  fi

  printf '%s\n' "$path"
}

is_manifest_row() {
  [[ -n "${1:-}" && "${1:0:1}" != "#" ]]
}

ensure_script_permissions() {
  local script title description modifiers key dependencies args

  while IFS=$'\t' read -r script title description modifiers key dependencies args; do
    is_manifest_row "$script" || continue
    chmod +x "$REPO_ROOT/src/$script"
  done <"$MANIFEST"
}

has_binding_key() {
  [[ -n "${1:-}" && "$1" != "NONE" && "$1" != "-" ]]
}

lua_escape() {
  local value="$1"

  value="${value//\\/\\\\}"
  printf '%s' "${value//\"/\\\"}"
}

lua_key_chord() {
  local modifiers="$1"
  local key="$2"

  if [[ "$modifiers" == "NONE" || "$modifiers" == "-" ]]; then
    printf '%s' "$key"
    return
  fi

  printf '%s + %s' "${modifiers// / + }" "$key"
}

render_command_path() {
  local script="$1"
  local args="${2:-}"
  local command_path

  command_path=$(display_path "$REPO_ROOT/src/$script")
  [[ -n "$args" && "$args" != "-" ]] && printf '%s %s\n' "$command_path" "$args" || printf '%s\n' "$command_path"
}

render_lua_unbind_line() {
  local modifiers="$1"
  local key="$2"
  local key_chord

  key_chord="$(lua_key_chord "$modifiers" "$key")"
  printf 'hl.unbind("%s")\n' "$(lua_escape "$key_chord")"
}

render_lua_binding_line() {
  local script="$1"
  local title="$2"
  local modifiers="$4"
  local key="$5"
  local args="${7:-}"
  local command_path key_chord

  command_path=$(render_command_path "$script" "$args")
  key_chord=$(lua_key_chord "$modifiers" "$key")
  printf 'o.bind("%s", "%s", "%s")\n' \
    "$(lua_escape "$key_chord")" "$(lua_escape "$title")" "$(lua_escape "$command_path")"
}

render_unbind_lines() {
  local script title description modifiers key dependencies args

  while IFS=$'\t' read -r script title description modifiers key dependencies args; do
    is_manifest_row "$script" || continue
    has_binding_key "$key" || continue
    render_lua_unbind_line "$modifiers" "$key"
  done <"$MANIFEST"
}

render_binding_lines() {
  local script title description modifiers key dependencies args

  while IFS=$'\t' read -r script title description modifiers key dependencies args; do
    is_manifest_row "$script" || continue
    has_binding_key "$key" || continue
    render_lua_binding_line "$script" "$title" "$description" "$modifiers" "$key" "$dependencies" "$args"
  done <"$MANIFEST"
}

render_bindings_block() {
  printf '%s\n' "$BEGIN_MARKER"
  printf '%s\n' '-- Managed by ./scripts/install.sh. Edit src/manifest.tsv, then rerun install.'
  printf '%s\n' '-- Keep new windows in the side stack; Omarchy promotes them to master by default.'
  printf '%s\n' 'hl.config({' '  master = {' '    new_status = "slave",' '  },' '})'
  printf '%s\n' '-- Prevent Alacritty activation requests from stealing focus.'
  printf '%s\n' 'o.window("^Alacritty$", {' '  focus_on_activate = false,' '})'
  printf '%s\n' '-- Unbind defaults first so managed shortcuts can override Quattro safely.'
  render_unbind_lines
  render_binding_lines
  printf '%s\n' "$END_MARKER"
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

install_bindings() {
  local file tmp

  file=$(hypr_bindings_lua_file)
  mkdir -p "$(dirname "$file")"
  touch "$file"
  backup_bindings_file "$file"
  tmp=$(mktemp)
  strip_existing_bindings "$file" | trim_trailing_blank_lines >"$tmp"
  { cat "$tmp"; printf '\n\n'; render_bindings_block; } >"$file"
  rm -f "$tmp"
}

reload_hyprland() {
  command -v hyprctl >/dev/null || return
  hyprctl reload >/dev/null 2>&1 || return 0
  hyprctl configerrors
}

alacritty_config_file() {
  printf '%s\n' "${ALACRITTY_CONFIG_FILE:-$HOME/.config/alacritty/alacritty.toml}"
}

alacritty_fragment_file() {
  printf '%s\n' "${ALACRITTY_FRAGMENT_FILE:-$HOME/.config/alacritty/omarchy-scripts.toml}"
}

hint_command_file() {
  printf '%s\n' "${OPEN_TERMINAL_HINT_FILE:-$HOME/.local/bin/omarchy-open-terminal-hint}"
}

backup_file() {
  local file="$1"

  cp -a "$file" "$file.bak.omarchy-scripts-$(date +'%Y%m%d%H%M%S')"
}

install_symlink() {
  local source="$1"
  local target="$2"

  mkdir -p "$(dirname "$target")"
  if [[ -L "$target" && "$(readlink -f "$target")" == "$(readlink -f "$source")" ]]; then
    return
  fi
  if [[ -e "$target" || -L "$target" ]]; then
    mv "$target" "$target.bak.omarchy-scripts-$(date +'%Y%m%d%H%M%S')"
  fi
  ln -s "$source" "$target"
}

ensure_alacritty_import() {
  local file tmp
  file=$(alacritty_config_file)
  [[ -f "$file" ]] || { printf 'Alacritty config missing: %s\n' "$file" >&2; return 1; }
  grep -Fq -- "\"$ALACRITTY_IMPORT\"" "$file" && return
  grep -Eq '^general\.import = \[[^]]*\][[:space:]]*$' "$file" || {
    printf 'Alacritty general.import has an unsupported format in %s; expected a one-line array.\n' "$file" >&2
    return 1
  }
  backup_file "$file"
  tmp=$(mktemp)
  awk -v import="$ALACRITTY_IMPORT" '
    !updated && /^general\.import = \[[^]]*\][[:space:]]*$/ {
      sub(/\][[:space:]]*$/, ", \"" import "\" ]")
      updated = 1
    }
    { print }
  ' "$file" >"$tmp"
  install -m 0644 "$tmp" "$file"
  rm -f "$tmp"
}

install_alacritty_config() {
  install_symlink "$REPO_ROOT/config/alacritty/omarchy-scripts.toml" "$(alacritty_fragment_file)"
  install_symlink "$REPO_ROOT/src/omarchy-open-terminal-hint.ts" "$(hint_command_file)"
  ensure_alacritty_import
  # Replacing an imported symlink does not always trigger Alacritty's file watcher.
  touch "$(alacritty_config_file)"
}

main() {
  ensure_script_permissions
  install_bindings
  install_alacritty_config
  reload_hyprland
  printf 'Installed omarchy-scripts keybindings and personal configurations.\n'
}

main "$@"
