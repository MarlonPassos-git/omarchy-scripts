# Grammar

Select Portuguese text and press **Super + Alt + G**. Grammar corrects spelling,
grammar and agreement, shortens unnecessary wording and keeps the meaning, tone
and structure. Its concise editing instructions follow the personal
**revisar-texto** skill: preserve the author's voice, facts and uncertainty,
without inventing context or adding artificial formality.

Without a selection, it uses the clipboard. In remote desktop windows, it prefers
the clipboard: copy the remote text before pressing the shortcut.

The correction is copied and pasted into the original window. If focus changes
while the request is running, Grammar only copies it and asks you to paste with
**Ctrl + V**. Avoid changing the selection while a revision is running.
Incomplete responses and API failures leave the clipboard untouched.

Grammar retains original blank-line spacing and line endings, including the
extra blank lines that Teams adds to plain text. It checks indentation, list
markers, Markdown formatting, links, code, checkboxes and emoji before copying.
If a revision cannot preserve this structure, the clipboard stays untouched.

When the selection or clipboard also offers HTML, Grammar revises only its text
nodes and copies both HTML and plain text. Paragraphs, lists, links, styles,
attributes, comments and inline formatting stay in the original HTML. Code and
preformatted blocks are protected. The destination chooses which representation
to paste; rich text editors can use HTML and plain inputs use text.

The source HTML is parsed with [parse5](https://parse5.js.org/), without rendering
it. Revised text is escaped before insertion, so model output cannot add HTML
elements. [Qt QMimeData](https://doc.qt.io/qt-6/qmimedata.html), via Python/PySide6,
offers the two formats together on Wayland. Its background owner exits when
another application replaces the clipboard; it opens no window.

Rich formatting must still be available in the live selection or clipboard.
Omarchy's clipboard history stores text entries as plain text, so selecting an
old entry cannot restore its original HTML. Copy from the source app again to
retain its rich formatting. HTML from an unrelated clipboard item is never
attached to a different selected text.

## Configuration

From the repository directory, run:

```bash
./src/omarchy-grammar.ts --configure
```

Enter the API base URL, model ID and API key. The key is hidden while typing.
Configuration is saved outside the repository in
`~/.config/omarchy-scripts/grammar.env`, with permissions restricted to your user.
`XDG_CONFIG_HOME` is respected.

The default endpoint is `https://api.openai.com/v1` and the default model is
`gpt-4.1-mini`. For OpenRouter, use `https://openrouter.ai/api/v1` and a model ID
such as `openai/gpt-4.1-mini`. Other providers must support OpenAI-compatible
`/chat/completions` requests; the base URL must include the provider's API version
prefix, when required. Text is sent to the configured provider.

List available models or test a correction without changing the clipboard:

```bash
./src/omarchy-grammar.ts --models
./src/omarchy-grammar.ts --stdout 'os menino foi na escola'
./src/omarchy-grammar.ts --model openai/gpt-4.1-mini --stdout 'agente precisa conversa'
printf '%s\n' 'os texto precisa de revisão' | ./src/omarchy-grammar.ts --stdin --stdout
```

Run `--configure` again to change the endpoint or default model. Enter keeps the
existing values, including the key. Use `--no-paste` to copy without pasting, or
`--config PATH` to select another configuration file. No wrapper is installed in
`~/.local/bin`; the shortcut runs the script directly from the clone.

Optional settings in `grammar.env`:

| Setting | Default | Purpose |
| --- | --- | --- |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible API base URL. |
| `OPENAI_MODEL` | `gpt-4.1-mini` | Provider model ID. |
| `OPENAI_API_KEY` | Required | API credential for that endpoint. |
| `GRAMMAR_TIMEOUT_MS` | `30000` | Request timeout, from 1 to 300000 milliseconds. |
| `GRAMMAR_AUTO_PASTE` | `true` | Set to `false` to always copy without pasting. |

Environment variables override file values; `--model` overrides the configured
model for a single run. Keys from the old `ai-omarchy` tool are not imported
automatically.

## Troubleshooting

- **HTTP 401:** register a valid key using `--configure`.
- **HTTP 402 or 429:** check provider credits or usage limits.
- **HTTP 404:** check the endpoint and model ID.
- **Correction copied but not pasted:** return to the destination and use
  **Ctrl + V**. Automatic paste requires `wtype` and an unchanged active window.
- **No selected text:** select text again or copy it first.

The script requires Node.js 24 or newer, `wl-paste`, `wl-copy`, `wtype`, `hyprctl`
and Omarchy. Rich text also requires Python 3 and PySide6 with Qt's Wayland
platform support. The helper is `src/lib/grammar-clipboard.py`; it is launched
by the main command with `/usr/bin/python3`, so Mise or virtual-environment
shims cannot select a Python without the system PySide6 package. It needs no
separate setup. Concurrent shortcut invocations
are rejected while a revision runs.
