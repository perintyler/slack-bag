/**
 * Convert markdown to Slack Block Kit blocks.
 *
 * Delegates to the in-bag converter at `../markdown-to-slack-blocks/`, which
 * emits native Block Kit structure (rich_text lists, preformatted, quotes and
 * real `table` blocks) rather than flattening everything to mrkdwn text.
 *
 * FAILURE MODE IS DELIBERATELY LOUD. This previously dynamic-imported a
 * converter behind a bare `catch` that silently fell back to a much weaker
 * built-in. That degradation was invisible: messages kept sending, just with
 * markedly worse formatting and no error anywhere, so a broken converter could
 * ship unnoticed. A conversion failure now throws with context attached.
 */

import type { KnownBlock } from "@slack/web-api";
import {
  markdownToSlackBlocks,
  plainTextFallback,
} from "../markdown-to-slack-blocks/index.js";
import type { ConvertOptions } from "../markdown-to-slack-blocks/index.js";

/**
 * Convert markdown to Slack Block Kit blocks.
 *
 * @throws if conversion fails — callers must NOT paper over this.
 */
export async function markdownToBlocks(
  markdown: string,
  options?: ConvertOptions
): Promise<KnownBlock[]> {
  try {
    return markdownToSlackBlocks(markdown, options);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    // Surface loudly: the caller aborts the send rather than quietly
    // delivering degraded formatting.
    console.error(
      `[pretty-slacker] markdown -> Block Kit conversion FAILED: ${detail}`
    );
    throw new Error(`Markdown to Block Kit conversion failed: ${detail}`, {
      cause: error,
    });
  }
}

/** Plain-text fallback for the message `text` field (notifications, a11y). */
export { plainTextFallback };
