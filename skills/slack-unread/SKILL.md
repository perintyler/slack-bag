---
name: slack-unread
description: Check for recent Slack DMs and @mentions. Use when asked to check Slack unreads, DMs, or mentions.
---

# Slack Unread

Check for recent Slack DMs and @mentions using the Slack search API.

## Auth

`SLACK_USER_TOKEN` is read from the environment — search is a user-token API,
a bot token cannot call it. Barry resolves the token from the barry's
configured source (vault, keychain, or a literal value):

```bash
barry vault set-env <barry> SLACK_USER_TOKEN <token> --source vault
```

Requires the `search:read` scope. Do not read the token out of a `.env` file —
that bypasses the credential chain and will not pick up a rotated secret.

## Queries

Slack search understands `to:me` and `-from:me`, so neither query needs your
user ID hardcoded.

### 1. Recent DMs (from humans, not bots)

```bash
curl -s -H "Authorization: Bearer $SLACK_USER_TOKEN" \
  "https://slack.com/api/search.messages?query=to%3Ame+-from%3Ame+in%3Aim&sort=timestamp&sort_dir=desc&count=20"
```

Post-filter: drop messages whose `username` matches a known bot, and any with
empty `text`.

### 2. @mentions in channels

`search.messages` does not expand `@me`, so resolve your own user ID once and
interpolate it:

```bash
USER_ID=$(curl -s -H "Authorization: Bearer $SLACK_USER_TOKEN" \
  https://slack.com/api/auth.test | jq -r '.user_id')

curl -s -H "Authorization: Bearer $SLACK_USER_TOKEN" \
  "https://slack.com/api/search.messages?query=%3C%40${USER_ID}%3E+-from%3Ame&sort=timestamp&sort_dir=desc&count=20"
```

## Configuration

Optional. Both filters have working defaults, so the skill runs unconfigured.

`BARRY_SLACK_CONFIG` — JSON, read from the environment:

```json
{
  "exclude_channels": ["engineering-github"],
  "bot_filter": ["github", "slackbot", "linear"]
}
```

- **`exclude_channels`** — channels too noisy to be worth surfacing, usually
  ones full of automated PR or deploy traffic. Append each as
  `+-in%3A<channel>` to the mentions query.
- **`bot_filter`** — usernames to drop from DM results. Defaults to
  `github`, `slackbot`, `linear`, `geekbot`. Match case-insensitively.

## Output format

**DMs** — recent DMs from real people:
```
- [time] from @username: message preview (truncated to ~100 chars)
```

**Mentions** — recent @mentions in channels:
```
- [time] @username in #channel: message preview (truncated to ~100 chars)
```

## Time window

Default: last 24 hours. The search API returns all-time results sorted by
recency, so always filter client-side — compare each message `ts` against the
current time and discard anything older than the window.

## Notes

- Bot messages in DMs are noise; filter them out
- Empty `text` fields (common with GitHub bot messages) should be skipped
- This skill is a data-fetching primitive. Use `check-slack` for the full
  workflow with notifications.
