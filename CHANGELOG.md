# Changelog

User-facing script changes are grouped by day. Each date is the release
identifier; commits and internal maintenance are intentionally omitted.

## 2026-08-20

### Changed

- Installer now manages screenshot, layout, and Spotify TUI bindings through
  Hyprland Lua on Omarchy Quattro.
- Spotify media-key overrides stay deferred so Quattro's working defaults remain
  active until shell media and OSD fallbacks are ported.

## 2026-08-17

### Added

- Added separate control-only Spotify TUI build without streaming support.

### Changed

- Spotify TUI now selects daemon playback device before opening.
- Spotify binary installer validates both profiles before replacing setup.

### Removed

- Spotify binary installer now removes obsolete versioned profiles and legacy
  project wrappers after successful validation.

## 2026-07-28

### Changed

- Spotify daemon startup now waits for Spotify network connectivity after boot.
- Installer now routes the Spotify desktop entry through current repository
  commands instead of legacy local wrappers.

## 2026-07-23

### Changed

- Spotify commands and the daemon now use a daemon-enabled `spotify_player`
  0.24.1 build, preserving OAuth refresh tokens after Spotify authentication
  changes.

## 2026-07-10

### Added

- Added Spotify TUI, daemon-backed media controls, runtime diagnostics, and
  control validation.
- Added managed Spotify shortcuts, player configuration, and user service setup.
- Installer now configures `master { new_status = slave }`, keeping newly opened
  windows in the side stack on `master` workspaces.

### Changed

- Active-window screenshots no longer open a preview; they still save the image,
  copy it to the clipboard, and notify the saved path.

## 2026-07-02

### Added

- Added active-window screenshot capture with file saving, clipboard copying,
  notification, and automatic preview.
- Added current-workspace toggle between `dwindle` and a focused main pane with a
  right-side stack.
- Added managed installation and removal of project Hyprland shortcuts.
