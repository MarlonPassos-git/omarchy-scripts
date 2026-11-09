# Omarchy Scripts

Personal scripts and configurations for [Omarchy](https://omarchy.org/) and
[Hyprland](https://hypr.land/). Commands live in `src/`, keybindings live in
`src/manifest.tsv`, and installation generates only project-owned configuration.

## Installation

Clone the repository, enter the directory, and run the installer:

```bash
git clone git@github.com:MarlonPassos-git/omarchy-scripts.git ~/projects/omarchy-scripts
cd ~/projects/omarchy-scripts
./scripts/install.sh
```

The installer activates the managed keybindings and personal Alacritty
configuration described below.

## Uninstall

Run the uninstaller:

```bash
cd ~/projects/omarchy-scripts
./scripts/uninstall.sh
```

The uninstaller removes project-managed keybindings and Alacritty symlinks. The
now-missing Alacritty import remains harmless and is reused by the next install.

## Alacritty configurations

Personal configurations installed without replacing Omarchy's main Alacritty
configuration:

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

The installer links the
[Alacritty fragment](config/alacritty/omarchy-scripts.toml) at
`~/.config/alacritty/omarchy-scripts.toml` and the
[hint command](src/omarchy-open-terminal-hint.ts) at
`~/.local/bin/omarchy-open-terminal-hint`. It adds the fragment to
`general.import` once and backs up files before replacing them with links. Edits
in the repository are therefore picked up directly by Alacritty.

## Codex notifications

Receive native Omarchy notifications for ready responses, completed or blocked
goals, paused work, interruptions, execution failures, and token or usage limits.
Questions show the first question and up to three options; their **Responder**
button returns to Codex. Approval buttons open the original session for review.
Buttons never answer questions or grant permissions automatically.

![Native Codex notification previews](.github/assets/codex-notifications.png)

These are captures of real Omarchy cards with example content. Colors, borders,
fonts, and buttons follow the desktop theme. Every type shows the Codex app icon. “Meta em andamento” is included as a
visual reference; intermediate goal turns stay quiet in normal use.

Install the opt-in integration:

```bash
cd ~/projects/omarchy-scripts
npm install --omit=dev
python3 scripts/install-codex-notifications.py
```

Requires Python 3.11+, Node.js 24+, Codex's local app-server daemon, and Omarchy's
notification service. Validated with Codex 0.167.0 and Omarchy 4.5. The small `ws`
runtime dependency connects to the local Unix socket; no build step or external
notification service is needed. Do not enable Herdr's system toasts for the same
Codex events, as that would produce a second notification source.

The installer backs up changed configuration, preserves unrelated settings and
hooks, and refuses to replace another `notify` integration. The observer starts
immediately and at login. Restart existing Codex terminal interfaces to load the
setting that disables duplicate terminal alerts. No Codex hook trust review or
agent restart is required for the observer itself.

Normal responses show at most 240 characters of the final message. A goal's
intermediate turns do not announce completion. Esc produces **Interrompido**;
a paused goal without an interrupted turn produces **Meta pausada**. Failures
remain visible until dismissed. All types respect Do Not Disturb, and an
identified session already in focus does not show another popup.

Clicking a notification returns to the originating Herdr pane, terminal, or
tmux pane when it can be identified safely. Herdr needs a visible Codex status
line containing the thread ID. If the thread belongs to a Herdr session without an attached window, **Abrir
sessão** reattaches that Herdr session and selects its pane. Other unidentified
origins open the exact Codex thread in a terminal. Closed or replaced known panes
and windows are never replaced by an arbitrary focus target.

Inspect the integration or show a harmless native preview:

```bash
node src/omarchy-codex-notify.ts --status
node src/omarchy-codex-notify.ts --preview input
node src/omarchy-codex-notify.ts --preview interrupted
node src/omarchy-codex-notify.ts --preview all
```

Preview types are `response`, `progress`, `goal-complete`, `input`, `approval`,
`blocked`, `budget`, `usage`, `interrupted`, `paused`, and `failed`. Previews use
example content, stay out of notification history, and their buttons do not
change any session. Expand a card to read longer questions and their options.

The observer reconnects automatically when the daemon restarts. If unavailable,
the existing `notify` command still delivers ready-response notifications;
the richer lifecycle notifications return when the observer reconnects.
To disconnect, run `node src/omarchy-codex-notify.ts --stop`, remove the managed
`~/.config/omarchy/hooks/post-boot.d/omarchy-codex-notifications.sh` hook, and
restore `notify` and `[tui].notifications` from the Codex configuration backup.
The general uninstaller leaves this opt-in integration in place.

Protocol and compatibility details are in
[Codex notification integration](docs/codex-notifications.md).

Validate without sending desktop notifications:

```bash
npm test
npm run typecheck
```

## Scheduled Git pushes

`omarchy-git-auto-push` pushes existing commits only. It does not stage files,
create commits, pull, rebase, push tags, or force-push.

The machine-local allowlist lives at
`~/.config/git-auto-push/repositories.conf`. Each entry pins policy, worktree,
and expected remote destination:

```text
personal|~/projects/example|github.com/example/example
work|~/Work/example|bitbucket.org/example/example
```

Paths in the real configuration must be absolute. `personal` accepts
`main`/`master`; `work` blocks them and requires the current branch to track a
same-named branch on `origin`. Every policy rejects detached HEAD, divergent
branches, missing upstreams, and changed remote destinations.

Validate and enable four daily runs:

```bash
./src/omarchy-git-auto-push.sh --dry-run
systemctl --user link "$PWD/systemd/user/omarchy-git-auto-push.service"
systemctl --user link "$PWD/systemd/user/omarchy-git-auto-push.timer"
systemctl --user enable --now omarchy-git-auto-push.timer
```

## Commands

| Title | Example | Description | Shortcut | Script | Dependencies |
| --- | --- | --- | --- | --- | --- |
| Codex notifications | - | Shows response, goal, interruption, failure, and interaction notifications with buttons that return to the session. | - | [omarchy-codex-notify.ts](src/omarchy-codex-notify.ts) | Node.js 24+, Codex daemon, `ws`, `omarchy`, `hyprctl`; `tmux` when used |
| Active window screenshot | <img src=".github/assets/omarchy-capture-active-window.gif" alt="Active window screenshot demo" width="420"> | Captures the active Hyprland window, saves it to Pictures, copies it to the clipboard, and shows a native notification with the saved path and image preview, including during Do Not Disturb. | `Super + Shift + Print` | [omarchy-capture-active-window.sh](src/omarchy-capture-active-window.sh) | [hyprctl](https://wiki.hypr.land/Configuring/Using-hyprctl/), [jq](https://jqlang.org/), [grim](https://man.archlinux.org/man/grim.1.en), [wl-copy](https://man.archlinux.org/man/wl-copy.1.en), `omarchy` |
| Main + side stack layout | <img src=".github/assets/omarchy-layout-main-two-stack.gif" alt="Main + side stack layout demo" width="420"> | Toggles the current workspace between `dwindle` and `master`, using the focused window as the main pane and stacking the other windows on the right. | `Super + Alt + L` | [omarchy-layout-main-two-stack.sh](src/omarchy-layout-main-two-stack.sh) | [hyprctl](https://wiki.hypr.land/Configuring/Using-hyprctl/), [jq](https://jqlang.org/), [notify-send](https://man.archlinux.org/man/notify-send.1.en) |
| Alacritty terminal hint | - | Opens images in imv, videos in the default player, files in Neovim, and directories and links through the desktop. | `Ctrl + Shift + O` | [omarchy-open-terminal-hint.ts](src/omarchy-open-terminal-hint.ts) | Node.js 24+, Alacritty, Neovim, `imv`, `xdg-open`, `notify-send` |
| Scheduled Git push | `./src/omarchy-git-auto-push.sh --dry-run` | Pushes existing commits from an explicit machine-local allowlist. Work repositories protect `main` and `master` and require a same-named branch on `origin`. | - | [omarchy-git-auto-push.sh](src/omarchy-git-auto-push.sh) | [git](https://git-scm.com/), `flock` |

## License

[MIT](LICENSE)
