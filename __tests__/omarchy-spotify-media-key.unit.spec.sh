#!/usr/bin/env bash
set -euo pipefail

SCRIPT_UNDER_TEST="./src/omarchy-spotify-media-key"

fail() {
  printf 'not ok - %s\n' "$1" >&2
  exit 1
}

assert_equal() {
  local expected="$1"
  local actual="$2"

  [[ "$actual" == "$expected" ]] || fail "expected <$expected>, got <$actual>"
}

assert_file_contains() {
  local file="$1"
  local expected="$2"

  grep -Fq -- "$expected" "$file" || fail "expected <$expected> in $file"
}

assert_line_count() {
  local file="$1"
  local pattern="$2"
  local expected="$3"
  local actual

  actual="$(grep -Fc -- "$pattern" "$file" || true)"
  [[ "$actual" == "$expected" ]] || fail "expected $expected lines matching <$pattern>, got $actual"
}

assert_json_value() {
  local file="$1"
  local filter="$2"
  local expected="$3"

  assert_equal "$expected" "$(jq -r "$filter" "$file")"
}

test_volume_debounce_default_is_one_second() {
  assert_file_contains "$SCRIPT_UNDER_TEST" 'SPOTIFY_VOLUME_DEBOUNCE_SECONDS=${SPOTIFY_VOLUME_DEBOUNCE_SECONDS:-1}'
}

write_fake_executable() {
  local filepath="$1"
  local source_code="$2"

  printf '%s\n' "$source_code" >"$filepath"
  chmod +x "$filepath"
}

write_fake_spotify_player() {
  local filepath="$1"

  write_fake_executable "$filepath" '#!/usr/bin/env bash
set -euo pipefail

args="$*"
printf "%s\n" "$args" >> "$SPOTIFY_TEST_CLI_LOG"

increment_counter() {
  local file="$1"
  local count=0

  [[ -f "$file" ]] && count="$(cat "$file")"
  count=$((count + 1))
  printf "%s\n" "$count" > "$file"
  printf "%s\n" "$count"
}

print_playback_json() {
  printf "%s\n" "{\"is_playing\":true,\"item\":{\"name\":\"Track\"},\"device\":{\"name\":\"spotify-player\",\"volume_percent\":70}}"
}

if [[ "$args" == *"get key playback"* ]]; then
  count="$(increment_counter "$SPOTIFY_TEST_COUNTER_DIR/get")"
  if [[ "${SPOTIFY_TEST_MODE:-healthy}" == "fail-twice-then-volume" && "$count" -le 2 ]]; then
    printf "%s\n" "http error: status code 400 Bad Request" >&2
    exit 1
  fi
  if [[ "${SPOTIFY_TEST_MODE:-healthy}" == "no-item" ]]; then
    printf "%s\n" "{\"is_playing\":false,\"item\":null,\"device\":{\"name\":\"spotify-player\",\"volume_percent\":70}}"
    exit 0
  fi
  if [[ "${SPOTIFY_TEST_MODE:-healthy}" == "next-drops-item" && -f "$SPOTIFY_TEST_COUNTER_DIR/next-done" ]]; then
    printf "%s\n" "{\"is_playing\":true,\"item\":null,\"device\":{\"name\":\"spotify-player\",\"volume_percent\":70}}"
    exit 0
  fi
  print_playback_json
  exit 0
fi

if [[ "$args" == *"playback next"* ]]; then
  printf "%s\n" "1" > "$SPOTIFY_TEST_COUNTER_DIR/next-done"
  exit 0
fi

if [[ "$args" == *"playback play-pause"* ]]; then
  count="$(increment_counter "$SPOTIFY_TEST_COUNTER_DIR/play-pause")"
  if [[ "${SPOTIFY_TEST_MODE:-healthy}" == "recover-play-pause" && "$count" == "1" ]]; then
    printf "%s\n" "http error: status code 400 Bad Request" >&2
    exit 1
  fi
  exit 0
fi

if [[ "$args" == *"playback volume"* ]]; then
  printf "%s\n" "$args" >> "$SPOTIFY_TEST_VOLUME_LOG"
  exit 0
fi

if [[ "$args" == *"playback start liked"* ]]; then
  printf "%s\n" "$args" >> "$SPOTIFY_TEST_START_LOG"
  exit 0
fi

exit 0'
}

write_common_fakes() {
  local tmpdir="$1"

  write_fake_spotify_player "$tmpdir/spotify_player"
  write_fake_executable "$tmpdir/playerctl" '#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "-p" && "${3:-}" == "status" ]]; then
  printf "%s\n" "${SPOTIFY_TEST_MPRIS_STATUS:-Playing}"
  exit 0
fi
if [[ "${1:-}" == "-l" ]]; then
  printf "%s\n" "spotify_player"
  exit 0
fi
exit 0'
  write_fake_executable "$tmpdir/systemctl" '#!/usr/bin/env bash
set -euo pipefail
printf "%s\n" "$*" >> "$SPOTIFY_TEST_SYSTEMCTL_LOG"'
  write_fake_executable "$tmpdir/pgrep" '#!/usr/bin/env bash
set -euo pipefail
printf "%s\n" "${SPOTIFY_TEST_DAEMON_COUNT:-1}"'
  write_fake_executable "$tmpdir/omarchy-swayosd-client" '#!/usr/bin/env bash
exit 0'
}

run_media_key_with_fakes() {
  local tmpdir="$1"
  local command="$2"

  PATH="$tmpdir:$PATH" \
    SPOTIFY_PLAYER="$tmpdir/spotify_player" \
    SPOTIFY_CONFIG_FOLDER="$tmpdir/config" \
    SPOTIFY_CACHE_FOLDER="$tmpdir/cache" \
    SPOTIFY_DAEMON_RESTART_WAIT_SECONDS=0 \
    SPOTIFY_MEDIA_KEY_LOG="$tmpdir/media-key.jsonl" \
    SPOTIFY_VOLUME_LOCK="$tmpdir/volume.lock" \
    SPOTIFY_VOLUME_STATE="$tmpdir/volume.state" \
    SPOTIFY_VOLUME_DEBOUNCE_SECONDS="${SPOTIFY_TEST_VOLUME_DEBOUNCE_SECONDS:-0.05}" \
    "$SCRIPT_UNDER_TEST" "$command"
}

test_play_pause_restarts_once_after_recoverable_error() {
  local tmpdir
  tmpdir=$(mktemp -d)
  trap 'rm -rf "$tmpdir"' RETURN

  mkdir -p "$tmpdir/config" "$tmpdir/cache" "$tmpdir/counters"
  touch "$tmpdir/cli.log" "$tmpdir/systemctl.log" "$tmpdir/volume.log" "$tmpdir/start.log"
  write_common_fakes "$tmpdir"

  SPOTIFY_TEST_MODE="recover-play-pause" \
    SPOTIFY_TEST_COUNTER_DIR="$tmpdir/counters" \
    SPOTIFY_TEST_CLI_LOG="$tmpdir/cli.log" \
    SPOTIFY_TEST_SYSTEMCTL_LOG="$tmpdir/systemctl.log" \
    SPOTIFY_TEST_VOLUME_LOG="$tmpdir/volume.log" \
    SPOTIFY_TEST_START_LOG="$tmpdir/start.log" \
    run_media_key_with_fakes "$tmpdir" play-pause

  assert_line_count "$tmpdir/cli.log" "playback play-pause" 2
  assert_line_count "$tmpdir/systemctl.log" "--user restart spotify-player.service" 1
  assert_json_value "$tmpdir/media-key.jsonl" '.daemon_restarted' "true"
  assert_json_value "$tmpdir/media-key.jsonl" '.restart_reason' "transport-error"
}

test_volume_recovers_playback_json_before_absolute_volume() {
  local tmpdir
  tmpdir=$(mktemp -d)
  trap 'rm -rf "$tmpdir"' RETURN

  mkdir -p "$tmpdir/config" "$tmpdir/cache" "$tmpdir/counters"
  touch "$tmpdir/cli.log" "$tmpdir/systemctl.log" "$tmpdir/volume.log" "$tmpdir/start.log"
  write_common_fakes "$tmpdir"

  SPOTIFY_TEST_MODE="fail-twice-then-volume" \
    SPOTIFY_TEST_COUNTER_DIR="$tmpdir/counters" \
    SPOTIFY_TEST_CLI_LOG="$tmpdir/cli.log" \
    SPOTIFY_TEST_SYSTEMCTL_LOG="$tmpdir/systemctl.log" \
    SPOTIFY_TEST_VOLUME_LOG="$tmpdir/volume.log" \
    SPOTIFY_TEST_START_LOG="$tmpdir/start.log" \
    SPOTIFY_TEST_MPRIS_STATUS="Playing" \
    run_media_key_with_fakes "$tmpdir" volume-up

  sleep 0.2
  assert_file_contains "$tmpdir/volume.log" "playback volume 75"
  assert_line_count "$tmpdir/systemctl.log" "--user restart spotify-player.service" 1
  assert_json_value "$tmpdir/media-key.jsonl" '.command' "volume-up"
  assert_json_value "$tmpdir/media-key.jsonl" '.route' "spotify"
}

test_recent_daemon_log_error_does_not_restart_when_playback_responds() {
  local tmpdir
  tmpdir=$(mktemp -d)
  trap 'rm -rf "$tmpdir"' RETURN

  mkdir -p "$tmpdir/config" "$tmpdir/cache" "$tmpdir/counters"
  touch "$tmpdir/cli.log" "$tmpdir/systemctl.log" "$tmpdir/volume.log" "$tmpdir/start.log"
  printf '%s\n' 'GetCurrentPlayback: http error: status code 400 Bad Request' >"$tmpdir/cache/spotify-player-test.log"
  write_common_fakes "$tmpdir"

  SPOTIFY_TEST_COUNTER_DIR="$tmpdir/counters" \
    SPOTIFY_TEST_CLI_LOG="$tmpdir/cli.log" \
    SPOTIFY_TEST_SYSTEMCTL_LOG="$tmpdir/systemctl.log" \
    SPOTIFY_TEST_VOLUME_LOG="$tmpdir/volume.log" \
    SPOTIFY_TEST_START_LOG="$tmpdir/start.log" \
    run_media_key_with_fakes "$tmpdir" play-pause

  assert_line_count "$tmpdir/systemctl.log" "--user restart spotify-player.service" 0
  assert_line_count "$tmpdir/cli.log" "playback play-pause" 1
  assert_json_value "$tmpdir/media-key.jsonl" '.daemon_restarted' "false"
  assert_json_value "$tmpdir/media-key.jsonl" '.restart_reason' "none"
  assert_json_value "$tmpdir/media-key.jsonl" '.daemon_health' "recent-log-errors-playback-ok"
  assert_json_value "$tmpdir/media-key.jsonl" '.duration_ms | type' "number"
}

test_play_pause_starts_liked_tracks_when_playback_item_is_missing() {
  local tmpdir
  tmpdir=$(mktemp -d)
  trap 'rm -rf "$tmpdir"' RETURN

  mkdir -p "$tmpdir/config" "$tmpdir/cache" "$tmpdir/counters"
  touch "$tmpdir/cli.log" "$tmpdir/systemctl.log" "$tmpdir/volume.log" "$tmpdir/start.log"
  write_common_fakes "$tmpdir"

  SPOTIFY_TEST_MODE="no-item" \
    SPOTIFY_TEST_COUNTER_DIR="$tmpdir/counters" \
    SPOTIFY_TEST_CLI_LOG="$tmpdir/cli.log" \
    SPOTIFY_TEST_SYSTEMCTL_LOG="$tmpdir/systemctl.log" \
    SPOTIFY_TEST_VOLUME_LOG="$tmpdir/volume.log" \
    SPOTIFY_TEST_START_LOG="$tmpdir/start.log" \
    SPOTIFY_TEST_MPRIS_STATUS="Playing" \
    run_media_key_with_fakes "$tmpdir" play-pause

  assert_file_contains "$tmpdir/start.log" "playback start liked --limit 50"
  assert_line_count "$tmpdir/cli.log" "playback play-pause" 0
  assert_json_value "$tmpdir/media-key.jsonl" '.route' "spotify-start-liked"
}

test_next_starts_liked_tracks_when_skip_drops_playback_item() {
  local tmpdir
  tmpdir=$(mktemp -d)
  trap 'rm -rf "$tmpdir"' RETURN

  mkdir -p "$tmpdir/config" "$tmpdir/cache" "$tmpdir/counters"
  touch "$tmpdir/cli.log" "$tmpdir/systemctl.log" "$tmpdir/volume.log" "$tmpdir/start.log"
  write_common_fakes "$tmpdir"

  SPOTIFY_TEST_MODE="next-drops-item" \
    SPOTIFY_TEST_COUNTER_DIR="$tmpdir/counters" \
    SPOTIFY_TEST_CLI_LOG="$tmpdir/cli.log" \
    SPOTIFY_TEST_SYSTEMCTL_LOG="$tmpdir/systemctl.log" \
    SPOTIFY_TEST_VOLUME_LOG="$tmpdir/volume.log" \
    SPOTIFY_TEST_START_LOG="$tmpdir/start.log" \
    run_media_key_with_fakes "$tmpdir" next

  assert_line_count "$tmpdir/cli.log" "playback next" 1
  assert_file_contains "$tmpdir/start.log" "playback start liked --limit 50"
  assert_json_value "$tmpdir/media-key.jsonl" '.route' "spotify-start-liked"
}

test_volume_command_is_throttled_when_volume_lock_is_busy() {
  local tmpdir lock_fd
  tmpdir=$(mktemp -d)
  trap 'rm -rf "$tmpdir"' RETURN

  mkdir -p "$tmpdir/config" "$tmpdir/cache" "$tmpdir/counters"
  touch "$tmpdir/cli.log" "$tmpdir/systemctl.log" "$tmpdir/volume.log" "$tmpdir/start.log"
  write_common_fakes "$tmpdir"
  exec {lock_fd}>"$tmpdir/volume.lock"
  flock -n "$lock_fd"

  SPOTIFY_TEST_COUNTER_DIR="$tmpdir/counters" \
    SPOTIFY_TEST_CLI_LOG="$tmpdir/cli.log" \
    SPOTIFY_TEST_SYSTEMCTL_LOG="$tmpdir/systemctl.log" \
    SPOTIFY_TEST_VOLUME_LOG="$tmpdir/volume.log" \
    SPOTIFY_TEST_START_LOG="$tmpdir/start.log" \
    run_media_key_with_fakes "$tmpdir" volume-up

  assert_line_count "$tmpdir/volume.log" "playback volume" 0
  assert_json_value "$tmpdir/media-key.jsonl" '.route' "spotify-volume-throttled"
}

test_rapid_volume_keys_send_only_the_final_spotify_volume() {
  local tmpdir
  tmpdir=$(mktemp -d)
  trap 'rm -rf "$tmpdir"' RETURN

  mkdir -p "$tmpdir/config" "$tmpdir/cache" "$tmpdir/counters"
  touch "$tmpdir/cli.log" "$tmpdir/systemctl.log" "$tmpdir/volume.log" "$tmpdir/start.log"
  write_common_fakes "$tmpdir"

  SPOTIFY_TEST_COUNTER_DIR="$tmpdir/counters" \
    SPOTIFY_TEST_CLI_LOG="$tmpdir/cli.log" \
    SPOTIFY_TEST_SYSTEMCTL_LOG="$tmpdir/systemctl.log" \
    SPOTIFY_TEST_VOLUME_LOG="$tmpdir/volume.log" \
    SPOTIFY_TEST_START_LOG="$tmpdir/start.log" \
    SPOTIFY_TEST_VOLUME_DEBOUNCE_SECONDS=0.15 \
    run_media_key_with_fakes "$tmpdir" volume-up

  SPOTIFY_TEST_COUNTER_DIR="$tmpdir/counters" \
    SPOTIFY_TEST_CLI_LOG="$tmpdir/cli.log" \
    SPOTIFY_TEST_SYSTEMCTL_LOG="$tmpdir/systemctl.log" \
    SPOTIFY_TEST_VOLUME_LOG="$tmpdir/volume.log" \
    SPOTIFY_TEST_START_LOG="$tmpdir/start.log" \
    SPOTIFY_TEST_VOLUME_DEBOUNCE_SECONDS=0.15 \
    run_media_key_with_fakes "$tmpdir" volume-up

  sleep 0.4
  assert_line_count "$tmpdir/volume.log" "playback volume" 1
  assert_file_contains "$tmpdir/volume.log" "playback volume 80"
}

test_volume_debounce_default_is_one_second
test_play_pause_restarts_once_after_recoverable_error
test_volume_recovers_playback_json_before_absolute_volume
test_recent_daemon_log_error_does_not_restart_when_playback_responds
test_play_pause_starts_liked_tracks_when_playback_item_is_missing
test_next_starts_liked_tracks_when_skip_drops_playback_item
test_volume_command_is_throttled_when_volume_lock_is_busy
test_rapid_volume_keys_send_only_the_final_spotify_volume
printf 'ok - omarchy-spotify-media-key\n'
