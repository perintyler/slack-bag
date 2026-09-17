import { getServicePort } from "@barry-rocks/env";

/**
 * Post a barry event so a Slack message addressed to the bot surfaces in the
 * events feed, the CLI, and the macOS app.
 *
 * Delivery goes over HTTP rather than the `Events` store directly: this service
 * keeps its own SQLite mention store and has no Postgres client, and the API is
 * already the path the slash-command handlers use.
 *
 * `record_event` — the tool an agent would reach for — is deliberately not used
 * here. It resolves a notifier and returns an instruction for the *agent* to act
 * on, and no agent is in this loop to follow through.
 */

export interface NotifyInput {
  kind: "im" | "mention";
  userName: string;
  channelName: string;
  text: string;
  permalink?: string | null;
}

/** Slack addresses the bot by raw id; strip it so the title reads as prose. */
function stripBotMention(text: string): string {
  return text.replace(/<@[UW][A-Z0-9]+>/g, "").replace(/\s+/g, " ").trim();
}

function buildTitle(input: NotifyInput): string {
  const body = stripBotMention(input.text);
  const where = input.kind === "im" ? "DM" : `#${input.channelName}`;
  const summary = body.length > 120 ? `${body.slice(0, 117)}…` : body;
  return summary
    ? `${input.userName} (${where}): ${summary}`
    : `${input.userName} sent a ${input.kind === "im" ? "DM" : "mention"} in ${where}`;
}

/**
 * Returns true when the event was accepted by the API.
 *
 * Failures are reported, never thrown: the mention is already persisted by the
 * time this runs, and losing the notification must not also lose the record.
 */
export async function notifyEvent(input: NotifyInput): Promise<boolean> {
  const secret = process.env.BARRY_SECRET ?? "";
  if (!secret) {
    // Without this the API answers 403 for every call — silence here would be
    // indistinguishable from an empty inbox.
    console.error("slack: BARRY_SECRET not configured — cannot record event");
    return false;
  }

  const url = `http://127.0.0.1:${getServicePort("api")}/api/v1/events`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-barry-secret": secret,
      },
      body: JSON.stringify({
        type: "notification",
        source: "slack-app",
        title: buildTitle(input),
        ...(input.permalink ? { body: input.permalink } : {}),
        severity: "info",
        data: {
          kind: input.kind,
          channel: input.channelName,
          user: input.userName,
          text: input.text,
          ...(input.permalink ? { permalink: input.permalink } : {}),
        },
      }),
    });

    if (!res.ok) {
      console.error(`slack: events API rejected notification (${res.status})`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("slack: failed to record event:", err instanceof Error ? err.message : err);
    return false;
  }
}
