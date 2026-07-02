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

write_fake_viewer() {
  local filepath="$1"
  local label="$2"

  printf '#!/bin/sh\nprintf "%s:%%s\\n" "$1" >> "$DEMO_TEST_LOG"\n' "$label" >"$filepath"
  chmod +x "$filepath"
}

test_display_path_uses_home_symbol() {
  assert_equal "~/Pictures/screenshot.png" "$(display_path "$HOME/Pictures/screenshot.png")"
}

test_preview_prefers_imv() {
  local tmpdir logfile viewer
  tmpdir=$(mktemp -d)
  logfile="$tmpdir/viewer.log"
  trap 'rm -rf "$tmpdir"' RETURN

  write_fake_viewer "$tmpdir/imv" imv
  write_fake_viewer "$tmpdir/xdg-open" xdg-open

  viewer=$(PATH="$tmpdir" screenshot_preview_command)
  assert_equal "imv" "$viewer"

  DEMO_TEST_LOG="$logfile" PATH="$tmpdir" open_screenshot_preview /tmp/demo.png
  wait_for_log "$logfile" "imv:/tmp/demo.png"
}

test_display_path_uses_home_symbol
test_preview_prefers_imv
printf 'ok - omarchy-capture-active-window\n'
