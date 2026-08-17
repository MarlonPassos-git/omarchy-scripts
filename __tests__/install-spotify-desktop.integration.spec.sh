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

test_install_replaces_legacy_spotify_desktop_commands() {
  local tmpdir
  tmpdir=$(mktemp -d)
  trap 'rm -rf "$tmpdir"' RETURN

  printf '%s\n' '# existing binding' >"$tmpdir/bindings.conf"
  printf '%s\n' 'Exec=spotify %u' 'Exec=spotify-media-key play-pause' >"$tmpdir/spotify.desktop"
  HYPR_BINDINGS_FILE="$tmpdir/bindings.conf" \
    SPOTIFY_DESKTOP_FILE="$tmpdir/spotify.desktop" \
    PATH="/usr/bin:/bin" \
    ./scripts/install >/dev/null

  assert_file_contains "$tmpdir/spotify.desktop" "Exec=\"$PWD/src/omarchy-spotify\" %u"
  assert_file_contains "$tmpdir/spotify.desktop" "Exec=\"$PWD/src/omarchy-spotify-media-key\" play-pause"
  assert_file_contains "$tmpdir/spotify.desktop" 'StartupWMClass=org.omarchy.omarchy-spotify-tui'
  assert_file_not_contains "$tmpdir/spotify.desktop" 'Exec=spotify '
  assert_file_not_contains "$tmpdir/spotify.desktop" 'Exec=spotify-media-key '
  assert_file_contains "$(find "$tmpdir" -name 'spotify.desktop.bak.omarchy-scripts-*' -print -quit)" 'Exec=spotify %u'
}

test_install_replaces_legacy_spotify_desktop_commands
printf 'ok - install Spotify desktop entry\n'
