# Slack (Barry Pack)

Slack messaging, search, and analytics tools.

## Tools

- `send_slack_message` — send a message to a Slack channel or thread
- `send_message_as_user` — send a Slack message as yourself (not as a bot)
- `list_slack_channels` — list all Slack channels the bot can access
- `get_relevant_messages` — search Slack for messages relevant to a query
- `get_channel_history` — get recent messages from a specific channel
- `get_my_messages` — get all messages sent by the authenticated user in a time period
- `get_barry_mentions` — retrieve messages where Barry was @mentioned
- `get_emoji_stats` — analyze emoji usage across channels by user
- `messaging_status` — check Slack messaging service status
- `status` — check Slack MCP server status and configuration

## Skills

- `check-slack` — check for unread DMs and mentions, summarize what needs attention
- `find-slack-channel-id` — find a Slack channel or DM ID by name
- `pretty-slack` — send Block Kit formatted Slack messages as your personal user
- `slack-myself` — send a message to yourself via the Barry bot DM
- `slack-unread` — check for recent Slack DMs and @mentions
- `team-activity` — summarize Slack activity per person over a timeframe

## Jobs

- `weekly-digest` — summarize the last 7 days of team Slack activity (Mondays at 9am)
