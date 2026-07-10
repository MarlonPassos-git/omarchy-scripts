# Changelog

User-facing script changes are grouped by day. Each date is the release
identifier; commits and internal maintenance are intentionally omitted.

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
