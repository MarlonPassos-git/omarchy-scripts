# Changelog

User-facing script changes are grouped by day. Each date is the release
identifier; commits and internal maintenance are intentionally omitted.

## 2026-09-10

### Removed

- Removed the Spotify TUI commands, media controls, installer, desktop entry,
  player configurations, and user service.

## 2026-09-09

### Added

- Added Codex completion notifications with the project name, a short response
  preview, and the Codex desktop icon through Omarchy's notification service.
- Added an opt-in installer that backs up Codex configuration and keeps approval
  alerts in the terminal without duplicate completion alerts.
- Suppressed Codex's internal title-generation notifications and preserved the
  installed Codex icon in Omarchy notification history using the native sender.
- Clicking a new Codex notification focuses its originating terminal and restores
  the tmux pane when applicable, without changing focus on delivery.

## 2026-08-20

### Changed

- Installer now manages screenshot and layout bindings through Hyprland Lua on
  Omarchy Quattro.

## 2026-07-10

### Added

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
