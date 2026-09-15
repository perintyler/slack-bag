/**
 * markdown-to-slack-blocks
 *
 * Converts markdown into Slack Block Kit blocks, preferring native structural
 * blocks (`rich_text_list`, `rich_text_preformatted`, `rich_text_quote`,
 * `table`, `header`, `divider`, `image`) over flattening everything into
 * mrkdwn `section` text.
 *
 * Zero runtime dependencies. Referenced by relative path; there is
 * deliberately no package.json (see the sibling `pretty-slacker/` directory
 * for the same convention).
 */

export { convert as markdownToSlackBlocks, plainTextFallback, chunkText } from "./convert.js";
export type { ConvertOptions } from "./convert.js";
export { escapeMrkdwn, parseInline, flattenToPlainText } from "./inline.js";
export { splitRow, buildTable, parseDelimiterRow } from "./tables.js";
export { LIMITS } from "./types.js";
export type {
  Block,
  RichTextBlock,
  RichTextBlockElement,
  RichTextElement,
  RichTextList,
  RichTextQuote,
  RichTextPreformatted,
  RichTextSection,
  TableBlock,
  TableCell,
  HeaderBlock,
  DividerBlock,
  SectionBlock,
  ImageBlock,
} from "./types.js";
