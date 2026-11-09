# Alacritty terminal hints

The [general installer](../README.md#installation) adds these features without
replacing Omarchy's main Alacritty configuration:

- `Ctrl+Shift+O` highlights URLs and local file paths printed in the terminal.
- Click a directory path ending in `/`, such as `~/Pictures/screenshots/`, to
  open it in the default file manager. Directory paths also support keyboard hints.
- Images open in Omarchy's native `imv` viewer, videos in the default video
  player, and other files in a new Alacritty window with Neovim. Directories and
  other links open through the desktop's default handler.
- To open a saved recording, press `Ctrl+Shift+O` and type the hint label shown
  beside its path (for example, a Jam `recording.mp4`).
- `file://` URLs, surrounding delimiters, and trailing sentence punctuation are
  normalized before a path is opened.
- Missing paths produce a desktop notification instead of opening an empty editor.
- Alacritty activation requests are prevented from stealing focus in Hyprland.

## Configuration

The installer links the
[Alacritty fragment](../config/alacritty/omarchy-scripts.toml) at
`~/.config/alacritty/omarchy-scripts.toml` and the
[hint command](../src/omarchy-open-terminal-hint.ts) at
`~/.local/bin/omarchy-open-terminal-hint`. It adds the fragment to
`general.import` once and backs up files before replacing them with links. Edits
in the repository are therefore picked up directly by Alacritty.

## Removal

The general uninstaller removes the project-managed Alacritty symlinks. The
now-missing Alacritty import remains harmless and is reused by the next install.
