#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'not ok - %s\n' "$1" >&2
  exit 1
}

assert_file_contains() {
  local file="$1"
  local expected="$2"

  grep -Fq -- "$expected" "$file" || fail "expected <$expected> in $file"
}

assert_file_not_contains() {
  local file="$1"
  local unexpected="$2"

  ! grep -Fq -- "$unexpected" "$file" || fail "unexpected <$unexpected> in $file"
}

assert_line_count() {
  local file="$1"
  local pattern="$2"
  local expected="$3"
  local actual

  actual="$(grep -Fc -- "$pattern" "$file" || true)"
  [[ "$actual" == "$expected" ]] || fail "expected $expected lines matching <$pattern>, got $actual"
}

write_fake_executable() {
  local filepath="$1"
  local source_code="$2"

  printf '%s\n' "$source_code" >"$filepath"
  chmod +x "$filepath"
}

repo_command_path() {
  local script="$1"
  local repo_path

  repo_path="${PWD#"$HOME/"}"
  printf '~/%s/src/%s\n' "$repo_path" "$script"
}

test_install_generates_quattro_bindings_without_media_overrides() {
  local tmpdir bindings_file capture_command layout_command spotify_command
  tmpdir=$(mktemp -d)
  bindings_file="$tmpdir/bindings.lua"
  trap 'rm -rf "$tmpdir"' RETURN

  write_fake_executable "$tmpdir/hyprctl" '#!/usr/bin/env sh
[ "$1" = "configerrors" ] && exit 0
exit 0'
  printf '%s\n' 'o.bind("SUPER + R", "Personal command", "personal-command")' >"$bindings_file"

  PATH="$tmpdir:$PATH" \
    HYPR_BINDINGS_LUA_FILE="$bindings_file" \
    SPOTIFY_DESKTOP_FILE="$tmpdir/spotify.desktop" \
    ./scripts/install >/dev/null
  capture_command="$(repo_command_path omarchy-capture-active-window)"
  layout_command="$(repo_command_path omarchy-layout-main-two-stack)"
  spotify_command="$(repo_command_path omarchy-spotify)"

  assert_file_contains "$bindings_file" 'o.bind("SUPER + R", "Personal command", "personal-command")'
  assert_file_contains "$bindings_file" 'hl.unbind("SUPER + SHIFT + PRINT")'
  assert_file_contains "$bindings_file" "o.bind(\"SUPER + SHIFT + PRINT\", \"Active window screenshot\", \"$capture_command\")"
  assert_file_contains "$bindings_file" "o.bind(\"SUPER + ALT + L\", \"Main + side stack layout\", \"$layout_command\")"
  assert_file_contains "$bindings_file" "o.bind(\"SUPER + SHIFT + M\", \"Spotify TUI\", \"$spotify_command\")"
  assert_file_contains "$bindings_file" 'new_status = "slave"'
  assert_file_not_contains "$bindings_file" 'omarchy-spotify-media-key'
  assert_file_not_contains "$bindings_file" 'XF86Audio'

  PATH="$tmpdir:$PATH" \
    HYPR_BINDINGS_LUA_FILE="$bindings_file" \
    SPOTIFY_DESKTOP_FILE="$tmpdir/spotify.desktop" \
    ./scripts/install >/dev/null
  assert_line_count "$bindings_file" '-- BEGIN omarchy-scripts' 1

  PATH="$tmpdir:$PATH" HYPR_BINDINGS_LUA_FILE="$bindings_file" ./scripts/uninstall >/dev/null
  assert_file_contains "$bindings_file" 'o.bind("SUPER + R", "Personal command", "personal-command")'
  assert_file_not_contains "$bindings_file" 'omarchy-capture-active-window'
  assert_file_not_contains "$bindings_file" '-- BEGIN omarchy-scripts'
}

test_install_generates_quattro_bindings_without_media_overrides
printf 'ok - install Quattro bindings without media overrides\n'
