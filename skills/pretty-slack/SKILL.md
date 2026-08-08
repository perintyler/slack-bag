---
name: pretty-slack
description: Send Block Kit formatted Slack messages as your own Slack user (not the bot). Use for DMs to teammates with rich formatting: dividers, sections, mrkdwn, buttons, headers.
---

# pretty-slack

Send Slack Block Kit messages as your own Slack user via `chat.postMessage`.
Markdown is automatically converted to Block Kit blocks using `@barry/md-to-slack-blocks`.

## Step 1: Always markdownify the message

Before anything else, always invoke the `convert-plaintext-to-md` skill on the message content — regardless of whether it appears to already contain markdown formatting. Then:
- Show the proposed markdown to the user and ask: "Here's how I'd format this — look good?"
- Wait for approval or edits before proceeding

## Step 2: Always get approval before sending

Once the markdown is finalised, show the user:
1. **Recipient** — name and channel ID
2. **Markdown source** — the full formatted message
3. **Block Kit preview** — run `--dry-run` and show the blocks JSON

Ask explicitly: "Ready to send?" — do not send until confirmed.

## Sending a message

Paths below are relative to the block root — run them from there.

```bash
# From a string
tsx skills/pretty-slack/scripts/send.mjs \
  --channel CHANNEL_ID \
  --message "# Hello\n\nThis is **bold** with a [link](https://example.com)"

# From a file
tsx skills/pretty-slack/scripts/send.mjs \
  --channel CHANNEL_ID \
  --file message.md

# Reply in a thread (using thread_ts)
tsx skills/pretty-slack/scripts/send.mjs \
  --channel CHANNEL_ID \
  --thread 1781113981.176759 \
  --message "Threaded reply"

# Reply in a thread (using a Slack message URL)
tsx skills/pretty-slack/scripts/send.mjs \
  --channel CHANNEL_ID \
  --thread-url https://myworkspace.slack.com/archives/C0123ABC456/p1781113981176759 \
  --message "Threaded reply"

# Dry run — prints blocks JSON without sending
tsx skills/pretty-slack/scripts/send.mjs \
  --channel CHANNEL_ID \
  --message "# Hello" \
  --dry-run
```

## Finding a channel ID

If the channel ID is unknown, use the `find-slack-channel-id` skill:

```bash
python3 skills/find-slack-channel-id/scripts/find_channel.py <name or email>
```

## Markdown support

`@barry/md-to-slack-blocks` converts standard markdown to Block Kit:
- `# Heading` → header block
- `**bold**`, `_italic_`, `` `code` `` → mrkdwn formatting
- `---` → divider block
- `[text](url)` → mrkdwn link
- Bullet/numbered lists → rich text blocks
- Blockquotes → quote blocks

## Auth

`SLACK_USER_TOKEN` is read from the environment. Barry resolves it from the
barry's configured source (vault, keychain, or a literal value):

```bash
barry vault set-env <barry> SLACK_USER_TOKEN <token> --source vault
```

Requires the `chat:write` scope. Messages post as you, not as the bot.
