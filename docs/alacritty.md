# Alacritty terminal hints

The [general installer](../README.md#installation) adds these features without
replacing Omarchy's main Alacritty configuration:

- `Ctrl+Shift+O` highlights URLs and local file paths printed in the terminal.
- Click a directory path ending in `/`, such as `~/Pictures/screenshots/`, to
  open it in the default file manager. Directory paths also support keyboard hints.
- Files, directories, and links open through `xdg-open`, using the desktop's
  default application for each MIME type or URL protocol. This includes images,
  videos, Markdown, PDFs, audio, archives, and `obsidian://` links.
- To open a saved recording, press `Ctrl+Shift+O` and type the hint label shown
  beside its path (for example, a Jam `recording.mp4`).
- `file://` URLs, surrounding delimiters, and trailing sentence punctuation are
  normalized before a path is opened.
- Missing paths produce a desktop notification instead of opening an empty editor.
- Alacritty activation requests are prevented from stealing focus in Hyprland.

## Copy command hints (beta)

Press `Ctrl+Shift+Y`, then type the letter label over a recognizable command to
copy it. `Esc` cancels without changing the clipboard. This uses Alacritty's
native hints in the current terminal, both standalone and with Herdr; it does
not open, zoom or replace panes. `Ctrl+Shift+O` still opens links and files.

The beta focuses on one-line shell commands in Codex responses, using command
names observed in session history. Quoting, accents and internal spacing are
preserved; outer padding, a prompt marker and the panel border are removed.
Selected text is copied as plain text and never executed or pasted automatically.

This is a text heuristic: it can also label commands in prose or neighboring
panes. Multiline blocks are not copied together, and the final line of a
continuation may look like a separate command. Lines without enough blank margin
before the end of the row or panel are skipped to reduce truncated copies.
Check the highlighted text before choosing its label.

## Configuration

The installer links the
[Alacritty fragment](../config/alacritty/omarchy-scripts.toml) at
`~/.config/alacritty/omarchy-scripts.toml` and the
[hint command](../src/omarchy-open-terminal-hint.ts) at
`~/.local/bin/omarchy-open-terminal-hint`. It adds the fragment to
`general.import` once and backs up files before replacing them with links. Edits
in the repository are therefore picked up directly by Alacritty.

The [copy handler](../src/omarchy-copy-code-hint.ts) is also symlinked at
`~/.local/bin/omarchy-copy-code-hint`; it requires `wl-copy`. The general installer
enables both hint shortcuts, and the uninstaller removes both command symlinks.

## Default applications

The hint command follows the desktop associations instead of selecting an editor
or viewer itself. Change them in the file manager's **Open With** settings or with
`xdg-mime`. For example, to open Markdown in Omawrite:

```bash
xdg-mime default omawrite.desktop text/markdown
xdg-mime default omawrite.desktop text/x-markdown
xdg-mime query default text/markdown
```

On Hyprland, install `perl-file-mimeinfo` so `xdg-open` detects registered MIME
types such as Markdown instead of treating them as plain text.

These are personal desktop settings; the installer does not change them. The
chosen application must be installed. Text paths must match a recognized hint
extension or directory; terminal hyperlinks are also supported. Obsidian links
use the registered `obsidian://` handler and are passed through unchanged.

## Removal

The general uninstaller removes the project-managed Alacritty symlinks. The
now-missing Alacritty import remains harmless and is reused by the next install.
