#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'not ok - %s\n' "$1" >&2
  exit 1
}

assert_contains() {
  local file="$1"
  local expected="$2"

  grep -Fq -- "$expected" "$file" || fail "expected <$expected> in $file"
}

assert_line_count() {
  local file="$1"
  local pattern="$2"
  local expected="$3"
  local actual

  actual=$(grep -oF -- "$pattern" "$file" | wc -l)
  [[ "$actual" == "$expected" ]] || fail "expected $expected occurrences of <$pattern>, got $actual"
}

test_alacritty_config_symlinks() {
  local tmpdir config fragment hint bindings target capture fake_bin
  tmpdir=$(mktemp -d)
  trap 'rm -rf "$tmpdir"' RETURN
  config="$tmpdir/alacritty.toml"
  fragment="$tmpdir/alacritty/omarchy-scripts.toml"
  hint="$tmpdir/bin/omarchy-open-terminal-hint"
  bindings="$tmpdir/bindings.lua"
  target="$tmpdir/example.py"
  capture="$tmpdir/command.log"
  fake_bin="$tmpdir/fake-bin"

  printf '%s\n' 'general.import = [ "theme.toml" ]' '' '[window]' 'opacity = 0.9' >"$config"
  printf '%s\n' '-- Personal binding' >"$bindings"
  mkdir -p "$(dirname "$fragment")" "$(dirname "$hint")" "$fake_bin"
  printf '%s\n' 'previous fragment' >"$fragment"
  printf '%s\n' 'previous command' >"$hint"
  printf '%s\n' '#!/usr/bin/env sh' 'exit 0' >"$fake_bin/hyprctl"
  printf '%s\n' '#!/usr/bin/env sh' 'printf "%s\\n" "$@" >"$COMMAND_CAPTURE"' >"$fake_bin/alacritty"
  chmod +x "$fake_bin/hyprctl" "$fake_bin/alacritty"

  PATH="$fake_bin:$PATH" \
    HYPR_BINDINGS_LUA_FILE="$bindings" \
    ALACRITTY_CONFIG_FILE="$config" \
    ALACRITTY_FRAGMENT_FILE="$fragment" \
    OPEN_TERMINAL_HINT_FILE="$hint" \
    ./scripts/install.sh >/dev/null

  touch -d '2000-01-01 00:00:00' "$config"
  PATH="$fake_bin:$PATH" \
    HYPR_BINDINGS_LUA_FILE="$bindings" \
    ALACRITTY_CONFIG_FILE="$config" \
    ALACRITTY_FRAGMENT_FILE="$fragment" \
    OPEN_TERMINAL_HINT_FILE="$hint" \
    ./scripts/install.sh >/dev/null

  [[ -L "$fragment" ]] || fail "Alacritty fragment is not a symlink"
  [[ -L "$hint" ]] || fail "hint command is not a symlink"
  [[ "$(readlink -f "$fragment")" == "$PWD/config/alacritty/omarchy-scripts.toml" ]] || fail "fragment points to the wrong source"
  [[ "$(readlink -f "$hint")" == "$PWD/src/omarchy-open-terminal-hint.ts" ]] || fail "hint points to the wrong source"
  assert_line_count "$config" '~/.config/alacritty/omarchy-scripts.toml' 1
  [[ "$(stat -c %Y "$config")" -gt 946684800 ]] || fail "Alacritty reload was not requested"
  assert_contains "$fragment" 'binding = { key = "O", mods = "Control|Shift" }'
  assert_contains "$fragment" 'mouse = { enabled = true, mods = "None" }'
  assert_contains "$config" 'opacity = 0.9'
  assert_contains "$bindings" 'focus_on_activate = false'
  [[ "$(find "$tmpdir/alacritty" -maxdepth 1 -name 'omarchy-scripts.toml.bak.*' | wc -l)" == 1 ]] || fail "fragment backup count differs"
  [[ "$(find "$tmpdir/bin" -maxdepth 1 -name 'omarchy-open-terminal-hint.bak.*' | wc -l)" == 1 ]] || fail "hint backup count differs"

  printf '%s\n' "print('ok')" >"$target"
  PATH="$fake_bin:$PATH" COMMAND_CAPTURE="$capture" "$hint" "($target)."
  [[ "$(paste -sd ' ' "$capture")" == "-e nvim -- $target" ]] || fail "file hint did not open Neovim"

  PATH="$fake_bin:$PATH" \
    HYPR_BINDINGS_LUA_FILE="$bindings" \
    ALACRITTY_FRAGMENT_FILE="$fragment" \
    OPEN_TERMINAL_HINT_FILE="$hint" \
    ./scripts/uninstall.sh >/dev/null

  [[ ! -e "$fragment" && ! -L "$fragment" ]] || fail "fragment symlink was not removed"
  [[ ! -e "$hint" && ! -L "$hint" ]] || fail "hint symlink was not removed"
  assert_line_count "$config" '~/.config/alacritty/omarchy-scripts.toml' 1
  ! grep -Fq -- 'focus_on_activate = false' "$bindings" || fail "Alacritty focus rule was not removed"
}

test_alacritty_config_symlinks
printf 'ok - install Alacritty configuration symlinks\n'
