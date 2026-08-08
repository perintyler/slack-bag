---
name: check-slack
description: Check Slack for unread DMs and mentions, then notify through the configured notifier if anything needs attention. Use when asked to check Slack or as a periodic check.
---

# Check Slack

Check for unread Slack DMs and @mentions, judge what matters, and push a
summary through whatever notifier the barry has configured.

## Workflow

1. Use the `slack-unread` skill to fetch recent DMs and @mentions (default:
   last 24 hours)
2. Evaluate the importance of each message
3. If anything is important, call `record_event` with a concise summary

## Notifying

`record_event` (events block) records the summary and resolves the barry's
notifier. It does not send anything itself — it returns an instruction naming
the tool to call, and you make that call. That indirection is the point: the
skill never needs to know whether the user is on SMS, Slack, or email.

```
record_event(
  message: "Slack check: @rem asking for help in #proj-agent; @andy DM'd about a PR",
  phase: "blocked"        # optional
)
```

- **Notifier configured** — the result carries `notify: {tool, target}` and an
  instruction. Call that tool with the summary.
- **No notifier** — the event is still recorded, and there is no `notify` field.
  Report the summary in-session instead. Do not fall back to a hardcoded tool.
- **One-off destination** — pass `notify_tool` (and optionally `target`) to
  `record_event` to override the default for a single call.

The user sets their notifier once, and any tool can serve:

```bash
barry notify set <barry> send_slack_message --target '#alerts'
barry notify set <barry> send_email --target me@example.com
```

## Importance rules

**Always important** (notify):
- Direct questions from coworkers (not bots)
- @mentions asking for help, review, or input
- Messages with urgency indicators ("urgent", "asap", "blocking", "blocker", "help")
- Messages from leadership or cross-team requests

**Not important** (skip):
- Bot notifications (GitHub, Linear, Geekbot, etc.)
- FYI-only mentions where no action is needed
- Messages already seen — e.g. you replied in the same thread
- Anything older than the time window

## Summary format

Keep it short; it may go out as an SMS.

```
Slack check:
- @rem in #proj-agent asking for help with a conversation (2:09 PM)
- @andy DM'd about PR review approach (1:33 PM)
```

If nothing is important, do not call `record_event` — just report that
everything is clear.

## Notes

- Composes `slack-unread` for data and `record_event` for delivery
- Use judgment on importance — err toward notifying for genuine human requests
- Always tell the user what you found, even when nothing warranted a notification
