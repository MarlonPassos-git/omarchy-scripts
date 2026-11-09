# Codex notification integration

The opt-in installer configures the existing `notify` handler as a fallback,
turns off terminal notifications, and installs a managed Omarchy post-boot hook.
The hook starts one detached observer per `CODEX_HOME`. It does not modify
Codex lifecycle hooks, Herdr configuration, or Omarchy's packaged files.
Backups of boot hooks live outside `post-boot.d/`, so Omarchy cannot execute them.

## Event handling

The observer connects to Codex's existing local control socket using WebSocket
transport. It only reads thread state and temporarily subscribes to pending
interactions. It never starts a turn, creates a goal, changes permissions,
responds to server requests, or resumes unloaded historical threads.

| Event | Behavior |
| --- | --- |
| `thread/started` | Track interactive root sessions; exclude ephemeral, exec, and subagent threads. |
| `thread/status/changed` | Detect waiting states, resumed work, and terminal transitions. |
| `thread/goal/updated` | Track actual goal state; unchanged usage updates stay quiet. |
| `thread/goal/cleared` | Stop associating subsequent responses with the old goal. |
| `item/tool/requestUserInput` | Display the replayed question and up to three options. |
| `*/requestApproval` | Show a navigation button; the user reviews approval in Codex. |
| `turn/completed` | Distinguish a completed, interrupted, or failed turn when subscribed. |
| `thread/closed` | Release cached thread state. |

The public documentation calls the user-input request `tool/requestUserInput`;
Codex 0.167.0 emits `item/tool/requestUserInput`. Both are accepted.

Global status events trigger a bounded read of the latest turn and goal.
At most three turn reads handle a terminal state arriving before its persisted
turn finishes updating. There is no recurring thread, transcript, or screen
polling. Streamed text, reasoning, and command-output deltas are opted out.
Thread results use the summary view to avoid loading full command output.

A permanent `thread/resume` subscription would keep a closed terminal's thread
loaded. The observer therefore subscribes only while an approval or question
is pending, receives any replayed request, and unsubscribes after resolution.
It does not return a response on behalf of the user. Basic waiting notifications
still work if replay is unavailable; option text depends on the request replay.

A short settling window coalesces goal and turn transitions. For example, a goal
paused by Esc and an interrupted turn become one interruption notification.
An old completed goal does not label a later ordinary response as goal completion.
Active goal continuations stay silent. Delivery deduplicates per turn and state,
and uses native replacement IDs to update a session's visible card.

All types use the bundled `assets/codex-symbolic.svg`, copied unchanged from
Omarchy's `shell/plugins/agents/assets/codex.svg`. The sender passes the asset as an explicit local image as well as the app icon,
so Omarchy does not fall back to the letter C when icon-theme lookup fails.
It does not require the Codex desktop app or state-specific font glyphs.

## Focus, privacy, and recovery

Herdr origin discovery matches the visible thread ID, then maps the named
session to its unique `org.omarchy.herdr-<session>` Hyprland window. Process
ancestry remains a fallback for older attached layouts; persistent pane processes
may belong to a detached Herdr server and cannot identify its GUI by ancestry. Results, including misses, are cached briefly. Clicking
revalidates the window address, PID, and stable identity; tmux also revalidates
the originating client and pane. A known Herdr origin without an attached window reattaches its named session
with `omarchy launch terminal herdr --session <name>` after selecting the pane.
Other unidentified origins can open the exact Codex thread in a terminal.

Focused-session suppression requires both the actual active Hyprland window and,
for Herdr, the focused pane. Multiplexed tmux sessions conservatively keep their
notifications when exact focus cannot be proved.

All model-provided text is bounded and escaped for notification markup. Commands
use argument arrays. The local IPC socket has mode `0600`; completion forwarding
omits prompts and bounds response text. Logs contain structured lifecycle codes,
not chat contents. They live at `~/.local/state/omarchy-scripts/codex-notifications.log`
(or under `XDG_STATE_HOME`). Native notification history contains response previews,
as with the previous integration. Preview cards are transient and use inert actions.

Omarchy 4.5 preserves visible card snapshots after D-Bus `CloseNotification`.
To withdraw a resolved prompt, the integration checks its ID in Omarchy's native
live store and uses the supported dismiss command only when the summary is
unambiguous. If the store is unavailable or another card matches, dismissal stays
with the desktop rather than affecting a different notification. This native-store
adapter may need updating with later Omarchy versions.

Daemon reconnects use bounded exponential backoff. Startup does not replay old
completed work. `notify` forwards bounded text to a connected observer; if that
thread is not covered, it falls back to a ready-response notification. Richer
states require a running local daemon. The observer does not start or restart
the Codex daemon or interrupt active work.

## Validation and visual reference

```bash
npm install
npm test
npm run typecheck
```

The integration suite runs the real WebSocket client against a local fake app
server. It covers quiet continuation, goal transitions, pending-question replay,
subscription cleanup, Esc, failures, reconnection, and historical-goal regressions.
The CLI suite covers native actions, safe text, focus validation, tmux, Herdr,
and all preview types. Installer tests use isolated Codex and configuration roots.

The committed gallery contains real Omarchy 4.5 screenshots with synthetic copy,
expanded to expose the buttons. It includes the quiet progress design for review;
normal goal continuation does not send that card. Individual captures are in
[the asset directory](../.github/assets/codex-notifications/).
Recreate individual states with `--preview <type>` on a running Omarchy desktop.

The implementation was also checked against Codex 0.167.0 in an isolated
`CODEX_HOME`, using a local mock model endpoint: global goal/status events,
execution failure, and replayed pending questions were verified without sending
requests to an external model service.

Sources: [Codex app-server](https://learn.chatgpt.com/docs/app-server),
[Codex notifications](https://learn.chatgpt.com/docs/config-file/config-advanced#notifications),
[Omarchy 4.5](https://omarchy.org/news/2026/11/omarchy-4-5/#notifications-rebuilt).
