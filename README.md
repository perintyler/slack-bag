# Slack (Barry Block)

Slack messaging, search, and analytics tools.

## Tools

- `send_slack_message` — send a message to a Slack channel or thread
- `send_message_as_user` — send a Slack message as yourself (not as a bot)
- `send_slack_message_to_self` — DM yourself, markdown rendered as Block Kit
- `list_slack_channels` — list all Slack channels the bot can access
- `get_relevant_messages` — search Slack for messages relevant to a query
- `get_channel_history` — get recent messages from a specific channel
- `get_my_messages` — get all messages sent by the authenticated user in a time period
- `get_barry_mentions` — retrieve messages where Barry was @mentioned
- `get_emoji_stats` — analyze emoji usage across channels by user
- `messaging_status` — check Slack messaging service status
- `status` — check Slack MCP server status and configuration

## Skills

- `check-slack` — check for unread DMs and mentions, notify through the configured notifier
- `find-slack-channel-id` — find a Slack channel or DM ID by name
- `pretty-slack` — send Block Kit formatted Slack messages as your own Slack user
- `slack-myself` — send a message to yourself via the bot DM
- `slack-unread` — check for recent Slack DMs and @mentions
- `team-activity` — summarize Slack activity per person over a timeframe

## Jobs

- `weekly-digest` — summarize the last 7 days of team Slack activity (Mondays at 9am)

## Setup

Two tokens, both resolved through Barry's credential chain — vault, keychain,
or a literal value. Nothing reads a `.env` file, so a rotated secret is picked
up on the next run.

```bash
barry vault set-env <barry> SLACK_BOT_TOKEN <token> --source vault
barry vault set-env <barry> SLACK_USER_TOKEN <token> --source keychain
```

- **`SLACK_BOT_TOKEN`** (`xoxb-`) — posting as the bot, listing channels,
  reading history. Scopes: `chat:write`, `channels:read`, `channels:history`,
  `users:read`, `im:write`.
- **`SLACK_USER_TOKEN`** (`xoxp-`) — search and posting as yourself. Search is
  a user-token API; a bot token cannot call it. Scopes: `search:read`,
  `chat:write`.

Tools that need the user token degrade with a clear error when it is absent,
so the bot token alone is a usable setup.

Your identity is never configured — `auth.test` resolves your user ID and
`conversations.open` resolves your self-DM channel at runtime.

### Optional configuration

`BARRY_SLACK_CONFIG` — JSON, for noise filtering. Both keys have defaults, so
the block works unset.

```json
{
  "exclude_channels": ["engineering-github"],
  "bot_filter": ["github", "slackbot", "linear", "geekbot"]
}
```

### Notifications

`check-slack` delivers through `record_event`, which resolves a notifier
rather than hardcoding one. Resolution order:

1. A `notify_tool` argument on the call
2. The barry's own `status_notify`
3. **This block's default — `send_slack_message_to_self`**
4. Nothing: findings are reported in-session

So with the block enabled and both tokens set, progress updates arrive as a
Slack DM to yourself with no configuration at all. The default takes no
target, which is what makes it usable unconfigured.

To send somewhere else, set your own — it always wins over the default:

```bash
barry notify set <barry> send_slack_message --target '#alerts'
barry notify set <barry> send_email --target me@example.com
```
