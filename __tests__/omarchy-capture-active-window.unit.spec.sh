#!/usr/bin/env bash
set -euo pipefail

source ./src/omarchy-capture-active-window

fail() {
  printf 'not ok - %s\n' "$1" >&2
  exit 1
}

assert_equal() {
  local expected="$1"
  local actual="$2"

  [[ "$actual" == "$expected" ]] || fail "expected '$expected', got '$actual'"
}

wait_for_log() {
  local logfile="$1"
  local expected="$2"

  for _ in {1..20}; do
    [[ -f $logfile ]] && grep -Fq "$expected" "$logfile" && return
    sleep 0.05
  done

  fail "expected log entry '$expected'"
}

write_fake_executable() {
  local filepath="$1"
  local source_code="$2"

  printf '%s\n' "$source_code" >"$filepath"
  chmod +x "$filepath"
}

test_display_path_uses_home_symbol() {
  assert_equal "~/Pictures/screenshot.png" "$(display_path "$HOME/Pictures/screenshot.png")"
}

test_main_saves_copies_and_does_not_open_preview() {
  local tmpdir clipboard_log notify_log viewer_log
  tmpdir=$(mktemp -d)
  clipboard_log="$tmpdir/clipboard.log"
  notify_log="$tmpdir/notify.log"
  viewer_log="$tmpdir/viewer.log"
  trap 'rm -rf "$tmpdir"' RETURN

  mkdir -p "$tmpdir/home"
  write_fake_executable "$tmpdir/hyprctl" '#!/bin/sh
printf "%s\n" "{\"at\":[11,22],\"size\":[333,444]}"'
  write_fake_executable "$tmpdir/grim" '#!/bin/sh
printf "%s\n" "png-bytes" > "$3"'
  write_fake_executable "$tmpdir/wl-copy" '#!/bin/sh
cat > "$DEMO_CLIPBOARD_LOG"'
  write_fake_executable "$tmpdir/notify-send" '#!/bin/sh
printf "%s\n" "$*" > "$DEMO_NOTIFY_LOG"'
  write_fake_executable "$tmpdir/imv" '#!/bin/sh
printf "%s\n" "imv:$*" >> "$DEMO_VIEWER_LOG"'
  write_fake_executable "$tmpdir/xdg-open" '#!/bin/sh
printf "%s\n" "xdg-open:$*" >> "$DEMO_VIEWER_LOG"'

  DEMO_CLIPBOARD_LOG="$clipboard_log" \
    DEMO_NOTIFY_LOG="$notify_log" \
    DEMO_VIEWER_LOG="$viewer_log" \
    HOME="$tmpdir/home" \
    PATH="$tmpdir:$PATH" \
    main

  assert_equal "png-bytes" "$(cat "$clipboard_log")"
  wait_for_log "$notify_log" "Active window screenshot saved"
  [[ ! -f $viewer_log ]] || fail "expected preview viewer not to run"
}

test_display_path_uses_home_symbol
test_main_saves_copies_and_does_not_open_preview
printf 'ok - omarchy-capture-active-window\n'
