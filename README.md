# Omarchy Scripts

Personal scripts for [Omarchy](https://omarchy.org/) and [Hyprland](https://hypr.land/). Commands live in `src/`, keybindings live in `src/manifest.tsv`, and installation generates the managed Quattro keybinding block in `~/.config/hypr/bindings.lua`.

## Installation

Clone the repository, enter the directory, and run the installer:

```bash
git clone git@github.com:MarlonPassos-git/omarchy-scripts.git ~/projects/omarchy-scripts
cd ~/projects/omarchy-scripts
./scripts/install
```

Installer currently activates active-window screenshot, main/side-stack layout,
and Spotify TUI bindings. Spotify media-key rows remain deferred while their
legacy `playerctl` and SwayOSD fallbacks are migrated to Omarchy Shell; Quattro's
default media bindings remain active in the meantime.

## Uninstall

Run the uninstaller:

```bash
cd ~/projects/omarchy-scripts
./scripts/uninstall
```

## Spotify Player TUI

This repository also stores the Spotify setup from
[Omarchy + Spotify TUI](https://blog.marlonpassos.com.br/pt-br/omarchy-spotify-tui/).
The setup keeps one `spotify_player --daemon` service as the real playback device
and opens the interactive TUI with a separate config that never starts another
streaming device. Commands and the service require `spotify_player` 0.24.1 or
newer because 0.24.0 can erase the cached OAuth refresh token.

The generic Linux archive published for 0.24.1 does not include daemon support.
Install both profiles required by this setup:

```bash
./scripts/install-spotify-player
```

Installer keeps full daemon-enabled binary at
`~/.local/opt/spotify-player-0.24.1/usr/bin/spotify_player` and builds separate
control-only TUI binary at
`~/.local/opt/spotify-player-tui-0.24.1/usr/bin/spotify_player`. TUI profile is
compiled without `streaming`, so it cannot register integrated Spotify Connect
device. After both binaries pass version and feature checks, installer removes
older versioned profiles and legacy project wrappers from `~/.local/bin`.

Reference files:

```bash
mkdir -p ~/.config/spotify-player ~/.config/spotify-player-tui ~/.config/systemd/user
cp config/spotify-player/app.toml ~/.config/spotify-player/app.toml
cp config/spotify-player-tui/app.toml ~/.config/spotify-player-tui/app.toml
cp systemd/user/spotify-player.service ~/.config/systemd/user/spotify-player.service
systemctl --user daemon-reload
systemctl --user enable --now spotify-player.service
./scripts/install
./src/omarchy-spotify-validate-controls
```

The service waits for Spotify HTTPS connectivity before starting, so a login
session that begins before the network is ready does not strand the daemon in an
invisible OAuth flow. The installer also generates
`~/.local/share/applications/spotify.desktop` with commands from the current
clone, preventing legacy `~/.local/bin/spotify*` wrappers from launching an
older `spotify_player`.

Before opening TUI, launcher transfers playback to daemon device named
`spotify-player`. Transfer failure does not block interface; it only leaves
Spotify's current device unchanged.

Media-key invocations write JSONL runtime logs with command duration, route, daemon
health, and restart reason:

```bash
tail -n 20 ~/.cache/omarchy-scripts/spotify-media-key.jsonl | jq .
```

If the daemon is alive but playback has no loaded item, `play`, `play-pause`,
`next`, and `previous` start liked tracks through `spotify_player playback start
liked --limit 50`; after that, normal playback controls work again. The same
fallback also runs after `next` or `previous` if Spotify accepts the command but
leaves playback with `item: null`.

Spotify volume keys are debounced locally. Each key press updates a local target
volume and shows the OSD immediately, then a single delayed 1-second
`spotify_player playback volume <target>` call applies the final value. This
prevents volume key repeat from flooding Spotify with Web API requests.

Recent daemon log errors only trigger a restart when a fresh playback probe also
fails. If playback still responds, the key command keeps the current daemon and
logs `recent-log-errors-playback-ok` instead of dropping the active item.

If 0.24.0 stored a null OAuth refresh token or Spotify rejects it with
`400 Bad Request`, move only the user token out of the active cache and
authenticate again with the same 0.24.1 binary used by the daemon:

```bash
systemctl --user stop spotify-player.service
backup_dir="$HOME/.cache/spotify-player/auth-backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup_dir"
mv ~/.cache/spotify-player/user_client_token.json "$backup_dir/user_client_token.json.active-bad"
~/.local/opt/spotify-player-0.24.1/usr/bin/spotify_player \
  --config-folder ~/.config/spotify-player \
  --cache-folder ~/.cache/spotify-player \
  authenticate
systemctl --user start spotify-player.service
```

## Commands

| Title | Example | Description | Shortcut | Script | Dependencies |
| --- | --- | --- | --- | --- | --- |
| Active window screenshot | <img src=".github/assets/omarchy-capture-active-window.gif" alt="Active window screenshot demo" width="420"> | Captures the active window, saves it to Pictures, copies it to the clipboard, and shows a notification with the saved path. | `Super + Shift + Print` | [omarchy-capture-active-window](src/omarchy-capture-active-window) | [hyprctl](https://wiki.hypr.land/Configuring/Using-hyprctl/), [jq](https://jqlang.org/), [grim](https://man.archlinux.org/man/grim.1.en), [wl-copy](https://man.archlinux.org/man/wl-copy.1.en), [notify-send](https://man.archlinux.org/man/notify-send.1.en) |
| Main + side stack layout | <img src=".github/assets/omarchy-layout-main-two-stack.gif" alt="Main + side stack layout demo" width="420"> | Toggles the current workspace between `dwindle` and `master`, using the focused window as the main pane and stacking the other windows on the right. | `Super + Alt + L` | [omarchy-layout-main-two-stack](src/omarchy-layout-main-two-stack) | [hyprctl](https://wiki.hypr.land/Configuring/Using-hyprctl/), [jq](https://jqlang.org/), [notify-send](https://man.archlinux.org/man/notify-send.1.en) |
| Spotify TUI | - | Opens or focuses the `spotify_player` TUI while playback stays on the daemon device. | `Super + Shift + M` | [omarchy-spotify](src/omarchy-spotify) | [spotify_player](https://github.com/aome510/spotify-player), `omarchy-launch-or-focus-tui` |
| Volume up | - | Routes volume up to `spotify_player` when Spotify is active; otherwise uses Omarchy system volume. | `XF86AudioRaiseVolume` | [omarchy-spotify-media-key](src/omarchy-spotify-media-key) `volume-up` | [spotify_player](https://github.com/aome510/spotify-player), [jq](https://jqlang.org/), [playerctl](https://github.com/altdesktop/playerctl), `omarchy-swayosd-client`, `systemctl`, `flock` |
| Volume down | - | Routes volume down to `spotify_player` when Spotify is active; otherwise uses Omarchy system volume. | `XF86AudioLowerVolume` | [omarchy-spotify-media-key](src/omarchy-spotify-media-key) `volume-down` | [spotify_player](https://github.com/aome510/spotify-player), [jq](https://jqlang.org/), [playerctl](https://github.com/altdesktop/playerctl), `omarchy-swayosd-client`, `systemctl`, `flock` |
| Next track | - | Routes next to `spotify_player` when Spotify has playback focus; otherwise uses the active media player. | `XF86AudioNext` | [omarchy-spotify-media-key](src/omarchy-spotify-media-key) `next` | [spotify_player](https://github.com/aome510/spotify-player), [jq](https://jqlang.org/), [playerctl](https://github.com/altdesktop/playerctl), `omarchy-swayosd-client`, `systemctl`, `flock` |
| Play/pause | - | Routes play/pause to `spotify_player` when Spotify has playback focus; otherwise uses the active media player. | `XF86AudioPlay` | [omarchy-spotify-media-key](src/omarchy-spotify-media-key) `play-pause` | [spotify_player](https://github.com/aome510/spotify-player), [jq](https://jqlang.org/), [playerctl](https://github.com/altdesktop/playerctl), `omarchy-swayosd-client`, `systemctl`, `flock` |
| Pause | - | Routes pause to `spotify_player` when Spotify has playback focus; otherwise uses the active media player. | `XF86AudioPause` | [omarchy-spotify-media-key](src/omarchy-spotify-media-key) `play-pause` | [spotify_player](https://github.com/aome510/spotify-player), [jq](https://jqlang.org/), [playerctl](https://github.com/altdesktop/playerctl), `omarchy-swayosd-client`, `systemctl`, `flock` |
| Previous track | - | Routes previous to `spotify_player` when Spotify has playback focus; otherwise uses the active media player. | `XF86AudioPrev` | [omarchy-spotify-media-key](src/omarchy-spotify-media-key) `previous` | [spotify_player](https://github.com/aome510/spotify-player), [jq](https://jqlang.org/), [playerctl](https://github.com/altdesktop/playerctl), `omarchy-swayosd-client`, `systemctl`, `flock` |
| Spotify TUI process | - | Connects daemon device and runs control-only `spotify_player` build with TUI config and shared cache. | - | [omarchy-spotify-tui](src/omarchy-spotify-tui) | [spotify_player](https://github.com/aome510/spotify-player) |
| Spotify debug state | - | Writes a read-only Spotify daemon, MPRIS, Hyprland, playback, and log snapshot under `/tmp`. | - | [omarchy-spotify-debug-state](src/omarchy-spotify-debug-state) | [spotify_player](https://github.com/aome510/spotify-player), [jq](https://jqlang.org/), [ripgrep](https://github.com/BurntSushi/ripgrep), `systemctl`, [playerctl](https://github.com/altdesktop/playerctl), [hyprctl](https://wiki.hypr.land/Configuring/Using-hyprctl/) |
| Spotify control validation | - | Validates daemon count, playback routing, play/pause, and Spotify volume sync. | - | [omarchy-spotify-validate-controls](src/omarchy-spotify-validate-controls) | [spotify_player](https://github.com/aome510/spotify-player), [jq](https://jqlang.org/), `pgrep`, `timeout` |

## License

[MIT](LICENSE)
