# codex-gemini-claude

A Claude Code plugin that shows how much context and usage **Claude**, **Codex** and **Gemini** are using, side by side, in a band just above the prompt.

It works in the Claude Code desktop app, the VS Code extension and the terminal.

## What it shows

One row sits above the prompt: a group each for Claude, Codex and Gemini, then a `+` button at the end:

```
✻ (1h)(4d) ▬▬▭▭      ❂ (2h)(4d) ▬▭▭▭      ✦ (3h)(6d) ▬▭▭▭      +
```

- **Thinking icon** (`✻` Claude, `❂` Codex, `✦` Gemini): gray while idle. It animates in the model's color while that model is working.
- **Usage rings**: one ring for the 5-hour window (thin line) and one for the weekly window (thick line).
  - The arc shows how much of the window is used.
  - The middle shows the time until the window resets (`3d`, `5h`, `42m`). With no reading, it shows `5h` or `1w`.
  - The middle text changes color as the window fills: gray, then grayish yellow from 50%, amber from 70%, red from 90%.
- **Context bar**: how full the model's context window is.

Press `+` to expand the details above the row:

- **Context**: the model, and tokens used out of the window.
- **Usage**: each window's percentage and its exact reset time.

On a wide enough band, the three models' details sit in three columns.

Codex's and Gemini's context come from the thread or conversation that the current Claude session started, so a new session starts empty.

The terminal draws no images, so there the rings and bars become text (`✻ 25%`).

### Pane

`/context-all` opens the same figures in a pane.

## Install

In Claude Code:

```
/plugin install codex-gemini-claude --marketplace MatLegat/codex-gemini-claude
```

### Requirements

- [Claude Code](https://claude.com/claude-code): the desktop app, the VS Code extension or the terminal. Keep it up to date: the band uses a recent plugin feature (tested with 2.1.323).
- `python3`
- The [Codex CLI](https://github.com/openai/codex), logged in
- The [Codex plugin for Claude Code](https://github.com/openai/codex-plugin-cc) (`openai-codex`). The Codex indicator reads its job records to tell when Codex is working.
- The [Antigravity CLI](https://antigravity.google) (`agy`), logged in, for Gemini.
- The Antigravity plugin for Claude Code (`agy`, from the `antigravity-cc` marketplace). The Gemini indicator watches its commands and its `agy:runner` subagent.

Without Codex or Gemini, the other models still work and the missing one shows `—`.

## Settings

The plugin has one option, **Band layout** (`layout`). Set it in the plugin's settings, or in `settings.json`:

```json
{
  "pluginConfigs": {
    "codex-gemini-claude": { "options": { "layout": "models" } }
  }
}
```

| Value | Layout |
| --- | --- |
| `models` (default) | The row described above. |
| `rings` | `Context` and `Usage` buttons, each followed by Claude's and Codex's marks. |
| `buttons` | One ring and one percentage button for Claude and for Codex. |

Gemini shows only in the `models` layout and in the pane.

## How it works

- **Claude's figures** come from Claude Code itself: the session's context and its rate limits.
- **Codex's figures** come from two scripts in [`codex-gemini-claude/scripts`](codex-gemini-claude/scripts):
  - `context-codex.py` reads the context of the session's Codex thread, and whether a Codex job is running, from `~/.codex/sessions` and the Codex plugin's job records.
  - `usage-codex.py` reads the 5-hour and weekly limits from `codex app-server`. If that fails, it falls back to the latest Codex session log.

- **Gemini's figures** come from two more scripts there:
  - `usage-gemini.py` runs `agy -p "/usage" --output-format json`, a local command that makes no model call, and keeps the Gemini group's 5-hour and weekly windows.
  - `context-gemini.py` finds the newest Gemini conversation written since this Claude session last started Gemini. While Gemini is idle, it reads that conversation's context over the CLI's Agent Client Protocol server (`agy acp`), at most once per change and one at a time. It never loads a conversation while one is running, so it can't get in the way.

Codex and Gemini context refresh every minute, and every 3 seconds while that model is working. Codex usage refreshes every 5 minutes, Gemini usage every 2 minutes and after each Gemini run. Opening the details always fetches fresh numbers.

The Antigravity CLI records no Claude session, so if you run Gemini by hand while a Claude session runs it, the band may show that conversation instead.

## Development

```
claude plugin test codex-gemini-claude
claude plugin validate codex-gemini-claude
```

Most look-and-feel choices, such as colors, ring and bar sizes, and line widths, are constants at the top of [`codex-gemini-claude/hooks/register.tsx`](codex-gemini-claude/hooks/register.tsx).
