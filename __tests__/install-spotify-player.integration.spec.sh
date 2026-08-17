#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'not ok - %s\n' "$1" >&2
  exit 1
}

assert_exists() {
  [[ -e "$1" || -L "$1" ]] || fail "expected <$1> to exist"
}

assert_missing() {
  [[ ! -e "$1" && ! -L "$1" ]] || fail "expected <$1> to be missing"
}

assert_output_contains() {
  local expected="$1" output
  shift

  output="$("$@")" || fail "command failed <$*>"
  grep -Fq -- "$expected" <<<"$output" || fail "expected <$expected> from command <$*>"
}

write_fake_cargo() {
  local path="$1"

  cp __tests__/fixtures/fake-spotify-cargo "$path"
  chmod +x "$path"
}

write_legacy_wrapper() {
  local path="$1"

  printf '%s\n' '#!/usr/bin/env bash' 'exec spotify_player "$@"' >"$path"
  chmod +x "$path"
}

test_installer_creates_profiles_then_removes_project_legacy_files() {
  local tmpdir full_binary tui_binary
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "$tmpdir"' RETURN
  mkdir -p "$tmpdir/opt/spotify-player-0.24.0" "$tmpdir/bin"
  write_fake_cargo "$tmpdir/cargo"
  write_legacy_wrapper "$tmpdir/bin/spotify"
  write_legacy_wrapper "$tmpdir/bin/spotify-tui.bak-old"
  printf 'keep\n' >"$tmpdir/bin/unrelated"

  FAKE_CARGO_LOG="$tmpdir/cargo.log" \
    SPOTIFY_OPT_ROOT="$tmpdir/opt" \
    SPOTIFY_BIN_ROOT="$tmpdir/bin" \
    CARGO_COMMAND="$tmpdir/cargo" \
    ./scripts/install-spotify-player >/dev/null

  full_binary="$tmpdir/opt/spotify-player-0.24.1/usr/bin/spotify_player"
  tui_binary="$tmpdir/opt/spotify-player-tui-0.24.1/usr/bin/spotify_player"
  assert_exists "$full_binary"
  assert_exists "$tui_binary"
  assert_output_contains '✓ streaming' "$full_binary" features
  assert_output_contains '✗ streaming' "$tui_binary" features
  [[ "$(readlink "$tmpdir/bin/spotify_player")" == "$full_binary" ]] || fail "spotify_player link does not target full profile"
  assert_missing "$tmpdir/opt/spotify-player-0.24.0"
  assert_missing "$tmpdir/bin/spotify"
  assert_missing "$tmpdir/bin/spotify-tui.bak-old"
  assert_exists "$tmpdir/bin/unrelated"
  [[ "$(wc -l <"$tmpdir/cargo.log")" == "2" ]] || fail "expected two cargo profile builds"
}

test_installer_preserves_legacy_files_when_validation_fails() {
  local tmpdir
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "$tmpdir"' RETURN
  mkdir -p "$tmpdir/opt/spotify-player-0.24.0" "$tmpdir/bin"
  write_fake_cargo "$tmpdir/cargo"
  write_legacy_wrapper "$tmpdir/bin/spotify"

  if FAKE_CARGO_LOG="$tmpdir/cargo.log" FAKE_CARGO_BAD_VERSION=1 \
    SPOTIFY_OPT_ROOT="$tmpdir/opt" SPOTIFY_BIN_ROOT="$tmpdir/bin" \
    CARGO_COMMAND="$tmpdir/cargo" ./scripts/install-spotify-player >/dev/null 2>&1; then
    fail "installer unexpectedly accepted invalid binary"
  fi

  assert_exists "$tmpdir/opt/spotify-player-0.24.0"
  assert_exists "$tmpdir/bin/spotify"
}

test_installer_creates_profiles_then_removes_project_legacy_files
test_installer_preserves_legacy_files_when_validation_fails
printf 'ok - Spotify dual-profile installation and cleanup\n'
