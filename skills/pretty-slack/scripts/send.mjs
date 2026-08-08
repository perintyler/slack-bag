#!/usr/bin/env tsx
/**
 * Send a Slack message as your own Slack user.
 * Converts markdown input to Slack Block Kit blocks via @barry/md-to-slack-blocks.
 *
 * Usage:
 *   echo "# Hello\n\nThis is **bold**" | node send.mjs --channel C0123ABC456
 *   node send.mjs --channel C0123ABC456 --message "# Hello\n\n**world**"
 *   node send.mjs --channel C0123ABC456 --file message.md
 *   node send.mjs --channel C0123ABC456 --thread THREAD_TS --message "threaded reply"
 *   node send.mjs --channel C0123ABC456 --thread-url https://workspace.slack.com/archives/C0123ABC456/p1781113981176759 --message "reply"
 */

import { readFileSync } from "fs";
import { parseArgs } from "util";
import { markdownToSlackBlocks } from "@barry/md-to-slack-blocks";

// Read the token from the environment. Barry resolves SLACK_USER_TOKEN from
// the barry's configured source (vault, keychain, or a literal value) and
// injects it before the skill runs, so nothing here reads a file on disk —
// that would bypass the credential chain and miss a rotated secret.
function loadToken() {
  const token = process.env.SLACK_USER_TOKEN;
  if (!token) {
    console.error(
      "ERROR: SLACK_USER_TOKEN is not set.\n" +
        "Configure it with:\n" +
        "  barry vault set-env <barry> SLACK_USER_TOKEN <token> --source vault",
    );
    process.exit(1);
  }
  return token;
}

async function main() {
  const { values } = parseArgs({
    options: {
      channel: { type: "string" },
      message: { type: "string" },
      file: { type: "string" },
      thread: { type: "string" },
      "thread-url": { type: "string" },
      "dry-run": { type: "boolean", default: false },
      "raw-blocks": { type: "boolean", default: false },
    },
    strict: false,
  });

  if (!values.channel) {
    console.error("Usage: node send.mjs --channel CHANNEL_ID [--message 'markdown' | --file message.md]");
    process.exit(1);
  }

  let markdown = values.message;
  if (!markdown && values.file) {
    markdown = readFileSync(values.file, "utf8");
  }
  if (!markdown) {
    // Read from stdin
    markdown = readFileSync("/dev/stdin", "utf8");
  }

  let blocks;
  if (values["raw-blocks"]) {
    // Input is raw JSON blocks, skip markdown conversion
    blocks = JSON.parse(markdown);
  } else {
    blocks = markdownToSlackBlocks(markdown);
  }
  const fallback = (markdown || "").replace(/[#*`_~>]/g, "").trim().split("\n")[0];

  if (values["dry-run"]) {
    console.log(JSON.stringify(blocks, null, 2));
    return;
  }

  // Resolve thread_ts from --thread or --thread-url
  let threadTs = values.thread;
  if (!threadTs && values["thread-url"]) {
    // Extract from Slack URL like https://workspace.slack.com/archives/C0123ABC456/p1781113981176759
    const match = values["thread-url"].match(/\/p(\d{10})(\d{6})$/);
    if (match) {
      threadTs = `${match[1]}.${match[2]}`;
    } else {
      console.error("ERROR: Could not parse thread_ts from URL:", values["thread-url"]);
      process.exit(1);
    }
  }

  const token = loadToken();
  const payload = {
    channel: values.channel,
    unfurl_links: false,
    blocks,
    text: fallback,
    ...(threadTs ? { thread_ts: threadTs } : {}),
  };

  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!data.ok) {
    console.error("Slack API error:", data.error);
    process.exit(1);
  }

  console.log(`Sent to ${values.channel} (ts: ${data.message?.ts})`);
}

main();
