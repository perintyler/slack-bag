/**
 * Inline markdown -> Block Kit rich text elements.
 *
 * Produces `RichTextElement[]` (text/link/emoji/user/channel) rather than
 * mrkdwn strings. Styles are carried structurally in the `style` object, which
 * is why NO escaping of `&`, `<`, `>` happens here: escaping is a property of
 * mrkdwn string encoding, and applying it to rich text would render the
 * literal `&amp;` to the user. See `escapeMrkdwn` for the string path.
 */

import type { RichTextElement, RichTextStyle, RichTextText } from "./types.js";

/** Style state carried down through nested emphasis. */
interface StyleState {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
}

/**
 * Escape the three characters Slack treats as control characters in mrkdwn
 * text. Used ONLY for mrkdwn strings (section blocks / plain-text fallbacks),
 * never for rich text `text` values and never for code content.
 */
export function escapeMrkdwn(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function styleObject(state: StyleState, code = false): RichTextStyle | undefined {
  const style: RichTextStyle = {};
  if (state.bold) style.bold = true;
  if (state.italic) style.italic = true;
  if (state.strike) style.strike = true;
  if (code) style.code = true;
  return Object.keys(style).length > 0 ? style : undefined;
}

function pushText(out: RichTextElement[], text: string, state: StyleState, code = false): void {
  if (text === "") return;
  const style = styleObject(state, code);
  const last = out[out.length - 1];
  // Merge adjacent runs with identical styling so we don't emit a separate
  // element per character when the parser advances one char at a time.
  if (last !== undefined && last.type === "text") {
    const lastStyle = JSON.stringify(last.style ?? null);
    if (lastStyle === JSON.stringify(style ?? null)) {
      last.text += text;
      return;
    }
  }
  const node: RichTextText = { type: "text", text };
  if (style) node.style = style;
  out.push(node);
}

/** A bare-URL match must not swallow trailing sentence punctuation. */
const BARE_URL = /^(https?:\/\/[^\s<>]+)/;
/** :emoji_name: — letters, digits, _, +, -, and the ::skin-tone-N:: suffix. */
const EMOJI = /^:([a-z0-9_+-]+):/i;
/** <@U123> or <#C123|name> style mentions already in Slack syntax. */
const SLACK_USER = /^<@([UW][A-Z0-9]+)>/;
const SLACK_CHANNEL = /^<#([C][A-Z0-9]+)(?:\|[^>]*)?>/;

/**
 * Trim characters that are almost certainly sentence punctuation rather than
 * part of the URL, while keeping balanced parentheses (Wikipedia-style URLs).
 */
function trimBareUrl(url: string): string {
  let end = url.length;
  while (end > 0) {
    const ch = url[end - 1];
    if (ch === undefined) break;
    if (".,;:!?".includes(ch)) {
      end -= 1;
      continue;
    }
    if (ch === ")") {
      const candidate = url.slice(0, end);
      const opens = (candidate.match(/\(/g) ?? []).length;
      const closes = (candidate.match(/\)/g) ?? []).length;
      if (closes > opens) {
        end -= 1;
        continue;
      }
    }
    break;
  }
  return url.slice(0, end);
}

/**
 * Read a markdown link destination starting at `(`, tolerating balanced
 * parentheses inside the URL and an optional "title" suffix.
 * Returns the url and the index just past the closing `)`, or null.
 */
function readLinkTarget(src: string, start: number): { url: string; next: number } | null {
  if (src[start] !== "(") return null;
  let depth = 0;
  let i = start;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === "\\") {
      i += 1;
      continue;
    }
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) return null;
  let inner = src.slice(start + 1, i);
  // Strip an optional title: [t](url "title")
  const titled = inner.match(/^(\S*)\s+["'(].*$/s);
  if (titled && titled[1] !== undefined) inner = titled[1];
  return { url: inner.trim(), next: i + 1 };
}

/** Find the matching closing delimiter, skipping over code spans. */
function findCloser(src: string, from: number, delim: string): number {
  let i = from;
  while (i < src.length) {
    if (src[i] === "\\") {
      i += 2;
      continue;
    }
    if (src[i] === "`") {
      // Skip an entire code span so `**` inside code doesn't close emphasis.
      const fence = /^`+/.exec(src.slice(i))?.[0] ?? "`";
      const close = src.indexOf(fence, i + fence.length);
      if (close === -1) return -1;
      i = close + fence.length;
      continue;
    }
    if (src.startsWith(delim, i)) return i;
    i += 1;
  }
  return -1;
}

interface EmphasisSpec {
  delim: string;
  style: StyleState;
  /** `_`-based delimiters must not fire inside snake_case identifiers. */
  wordBoundary: boolean;
}

const EMPHASIS: EmphasisSpec[] = [
  { delim: "***", style: { bold: true, italic: true }, wordBoundary: false },
  { delim: "___", style: { bold: true, italic: true }, wordBoundary: true },
  { delim: "~~", style: { strike: true }, wordBoundary: false },
  { delim: "**", style: { bold: true }, wordBoundary: false },
  { delim: "__", style: { bold: true }, wordBoundary: true },
  { delim: "*", style: { italic: true }, wordBoundary: false },
  { delim: "_", style: { italic: true }, wordBoundary: true },
];

/**
 * Attempt to match an emphasis run starting at `start`. Returns the parsed
 * inner elements and the index just past the closing delimiter, or null.
 */
function tryEmphasis(
  src: string,
  start: number,
  state: StyleState
): { elements: RichTextElement[]; next: number } | null {
  for (const spec of EMPHASIS) {
    if (!src.startsWith(spec.delim, start)) continue;

    if (spec.wordBoundary) {
      const prev = start > 0 ? src[start - 1] : undefined;
      if (prev !== undefined && /[A-Za-z0-9]/.test(prev)) continue;
    }

    const contentStart = start + spec.delim.length;
    const close = findCloser(src, contentStart, spec.delim);
    // Require non-empty content: `**` alone is literal text.
    if (close === -1 || close <= contentStart) continue;

    if (spec.wordBoundary) {
      const after = src[close + spec.delim.length];
      if (after !== undefined && /[A-Za-z0-9]/.test(after)) continue;
    }

    return {
      elements: parseInline(src.slice(contentStart, close), { ...state, ...spec.style }),
      next: close + spec.delim.length,
    };
  }
  return null;
}

/**
 * Parse inline markdown into rich text elements.
 *
 * Handles: `**bold**`, `__bold__`, `*italic*`, `_italic_`, `***both***`,
 * `~~strike~~`, `` `code` `` (incl. multi-backtick fences), `[text](url)`,
 * bare URLs, `<url>`, `:emoji:`, `<@U…>`, `<#C…>`, and backslash escapes.
 */
export function parseInline(src: string, state: StyleState = {}): RichTextElement[] {
  const out: RichTextElement[] = [];
  let i = 0;
  let pending = "";

  const flush = (): void => {
    pushText(out, pending, state);
    pending = "";
  };

  while (i < src.length) {
    const rest = src.slice(i);
    const ch = src[i];

    // Backslash escape: the next character is literal.
    if (ch === "\\" && i + 1 < src.length) {
      const next = src[i + 1];
      if (next !== undefined && /[\\`*_~\[\]()#+\-.!>|]/.test(next)) {
        pending += next;
        i += 2;
        continue;
      }
    }

    // Inline code span. Content is verbatim — no nested parsing, no escaping.
    if (ch === "`") {
      const fence = /^`+/.exec(rest)?.[0] ?? "`";
      const close = src.indexOf(fence, i + fence.length);
      if (close !== -1) {
        let code = src.slice(i + fence.length, close);
        // CommonMark strips one leading+trailing space, which is how you write
        // a code span whose content starts or ends with a backtick.
        if (code.length > 1 && code.startsWith(" ") && code.endsWith(" ")) {
          code = code.slice(1, -1);
        }
        flush();
        pushText(out, code, state, true);
        i = close + fence.length;
        continue;
      }
    }

    // Slack-native mentions passed through verbatim.
    const user = SLACK_USER.exec(rest);
    if (user && user[1] !== undefined) {
      flush();
      out.push({ type: "user", user_id: user[1] });
      i += user[0].length;
      continue;
    }
    const channel = SLACK_CHANNEL.exec(rest);
    if (channel && channel[1] !== undefined) {
      flush();
      out.push({ type: "channel", channel_id: channel[1] });
      i += channel[0].length;
      continue;
    }

    // Autolink: <https://example.com>
    if (ch === "<") {
      const auto = /^<(https?:\/\/[^\s>]+)>/.exec(rest);
      if (auto && auto[1] !== undefined) {
        flush();
        const style = styleObject(state);
        const link: RichTextElement = { type: "link", url: auto[1] };
        if (style) link.style = style;
        out.push(link);
        i += auto[0].length;
        continue;
      }
    }

    // Image ![alt](url) — inline images have no rich-text representation, so
    // render the alt text as a link to the image.
    if (ch === "!" && src[i + 1] === "[") {
      const closeBracket = findCloser(src, i + 2, "]");
      if (closeBracket !== -1) {
        const target = readLinkTarget(src, closeBracket + 1);
        if (target) {
          const alt = src.slice(i + 2, closeBracket);
          flush();
          const style = styleObject(state);
          const link: RichTextElement = { type: "link", url: target.url };
          if (alt) link.text = alt;
          if (style) link.style = style;
          out.push(link);
          i = target.next;
          continue;
        }
      }
    }

    // Link [text](url)
    if (ch === "[") {
      const closeBracket = findCloser(src, i + 1, "]");
      if (closeBracket !== -1) {
        const target = readLinkTarget(src, closeBracket + 1);
        if (target) {
          const label = src.slice(i + 1, closeBracket);
          flush();
          const inner = parseInline(label, state);
          const style = styleObject(state);
          // A link element carries a single flat text; if the label had its own
          // styling we keep the label text and the link's own style.
          const labelText = inner
            .map((el) => (el.type === "text" ? el.text : el.type === "link" ? (el.text ?? el.url) : ""))
            .join("");
          const link: RichTextElement = { type: "link", url: target.url };
          if (labelText && labelText !== target.url) link.text = labelText;
          const innerStyle = inner.length === 1 && inner[0]?.type === "text" ? inner[0].style : undefined;
          const merged = { ...(style ?? {}), ...(innerStyle ?? {}) };
          if (Object.keys(merged).length > 0) link.style = merged;
          out.push(link);
          i = target.next;
          continue;
        }
      }
    }

    // Emphasis delimiters, longest first so *** beats ** beats *.
    // `_` variants require word boundaries so snake_case is not mangled.
    const emphasis = tryEmphasis(src, i, state);
    if (emphasis) {
      flush();
      out.push(...emphasis.elements);
      i = emphasis.next;
      continue;
    }

    // :emoji:
    const emoji = EMOJI.exec(rest);
    if (emoji && emoji[1] !== undefined) {
      flush();
      out.push({ type: "emoji", name: emoji[1] });
      i += emoji[0].length;
      continue;
    }

    // Bare URL
    const bare = BARE_URL.exec(rest);
    if (bare && bare[1] !== undefined) {
      const url = trimBareUrl(bare[1]);
      if (url.length > 0) {
        flush();
        const style = styleObject(state);
        const link: RichTextElement = { type: "link", url };
        if (style) link.style = style;
        out.push(link);
        i += url.length;
        continue;
      }
    }

    pending += ch ?? "";
    i += 1;
  }

  flush();
  return out;
}

/**
 * Flatten rich text elements to a plain string (used for table cells that
 * carry no formatting, headers, and the message fallback text).
 */
export function flattenToPlainText(elements: RichTextElement[]): string {
  return elements
    .map((el) => {
      switch (el.type) {
        case "text":
          return el.text;
        case "link":
          return el.text ?? el.url;
        case "emoji":
          return `:${el.name}:`;
        case "user":
          return `<@${el.user_id}>`;
        case "channel":
          return `<#${el.channel_id}>`;
      }
    })
    .join("");
}
