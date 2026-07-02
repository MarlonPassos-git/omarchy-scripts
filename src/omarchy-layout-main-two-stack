#!/usr/bin/env bash
set -euo pipefail

notify_layout_error() {
  notify-send -u normal "Layout failed" "$1" || true
}

read_hypr_json() {
  local label="$1"
  shift

  local payload
  if ! payload=$(hyprctl "$@" -j 2>/dev/null); then
    notify_layout_error "$label unavailable; expected Hyprland JSON response."
    exit 1
  fi

  if ! jq -e . >/dev/null <<<"$payload"; then
    notify_layout_error "$label returned '$payload'; expected valid JSON."
    exit 1
  fi

  printf '%s\n' "$payload"
}

workspace_addresses() {
  jq -r --arg ws "$1" '
    .[] |
    select((.workspace.id | tostring) == $ws and .mapped == true) |
    .address
  ' <<<"$2"
}

workspace_layout() {
  jq -r '.tiledLayout' <<<"$1"
}

set_windows_tiled() {
  local address
  for address in "$@"; do
    hyprctl dispatch settiled "address:$address" >/dev/null
  done
}

apply_master_stack_layout() {
  local workspace_id="$1"

  # Keep master scoped to the current workspace; global master leaked between workspaces.
  hyprctl keyword general:layout dwindle >/dev/null
  hyprctl keyword workspace "$workspace_id, layout:master" >/dev/null
  hyprctl dispatch layoutmsg orientationleft >/dev/null
  hyprctl dispatch layoutmsg mfact exact 0.76 >/dev/null
}

disable_master_stack_layout() {
  local workspace_id="$1"

  hyprctl keyword workspace "$workspace_id, layout:dwindle" >/dev/null
  notify-send -u low "Tiled stack layout disabled" "Workspace $workspace_id returned to dwindle." || true
}

promote_focused_window() {
  local active_address="$1"

  hyprctl dispatch focuswindow "address:$active_address" >/dev/null
  hyprctl dispatch layoutmsg swapwithmaster master ignoremaster >/dev/null
  hyprctl dispatch focuswindow "address:$active_address" >/dev/null
}

active_window_json=$(read_hypr_json "active window" activewindow)
active_workspace_json=$(read_hypr_json "active workspace" activeworkspace)
clients_json=$(read_hypr_json "clients" clients)

active_address=$(jq -r '.address' <<<"$active_window_json")
workspace_id=$(jq -r '.id | tostring' <<<"$active_workspace_json")
current_layout=$(workspace_layout "$active_workspace_json")
mapfile -t addresses < <(workspace_addresses "$workspace_id" "$clients_json")

if [[ "$current_layout" == "master" ]]; then
  disable_master_stack_layout "$workspace_id"
  exit 0
fi

if (( ${#addresses[@]} < 2 )); then
  notify_layout_error "workspace has ${#addresses[@]} window; expected at least 2."
  exit 1
fi

set_windows_tiled "${addresses[@]}"
apply_master_stack_layout "$workspace_id"
promote_focused_window "$active_address"

notify-send -u low "Tiled stack layout applied" "Focused window is master; other windows stack on the right." || true
