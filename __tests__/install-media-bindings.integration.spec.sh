#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'not ok - %s\n' "$1" >&2
  exit 1
}

assert_file_contains() {
  local file="$1"
  local expected="$2"

  grep -Fq "$expected" "$file" || fail "expected <$expected> in $file"
}

assert_file_not_contains() {
  local file="$1"
  local unexpected="$2"

  ! grep -Fq "$unexpected" "$file" || fail "unexpected <$unexpected> in $file"
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

test_install_generates_media_bindings_and_master_layout_config() {
  local tmpdir bindings_file media_key spotify_command
  tmpdir=$(mktemp -d)
  bindings_file="$tmpdir/bindings.conf"
  trap 'rm -rf "$tmpdir"' RETURN

  write_fake_executable "$tmpdir/hyprctl" '#!/usr/bin/env sh
[ "$1" = "configerrors" ] && exit 0
exit 0'
  printf '%s\n' \
    'bindd = SUPER SHIFT, M, Music TUI, exec, omarchy-launch-or-focus-tui spotify-tui' \
    '# Spotify TUI media-key routing. Falls back to Omarchy defaults.' \
    'bindld = , XF86AudioNext, Next track, exec, spotify-media-key next' \
    >"$bindings_file"

  PATH="$tmpdir:$PATH" HYPR_BINDINGS_FILE="$bindings_file" ./scripts/install >/dev/null
  media_key="$(repo_command_path omarchy-spotify-media-key)"
  spotify_command="$(repo_command_path omarchy-spotify)"

  assert_file_contains "$bindings_file" 'unbind = , XF86AudioNext'
  assert_file_contains "$bindings_file" "bindld = , XF86AudioNext, Next track, exec, $media_key next"
  assert_file_contains "$bindings_file" "bindeld = , XF86AudioRaiseVolume, Volume up, exec, $media_key volume-up"
  assert_file_contains "$bindings_file" "bindd = SUPER SHIFT, M, Spotify TUI, exec, $spotify_command"
  assert_file_contains "$bindings_file" 'new_status = slave'
  assert_file_not_contains "$bindings_file" 'exec, spotify-media-key'
  assert_file_not_contains "$bindings_file" 'omarchy-launch-or-focus-tui spotify-tui'
}

test_install_generates_media_bindings_and_master_layout_config
printf 'ok - install media bindings and master layout config\n'
