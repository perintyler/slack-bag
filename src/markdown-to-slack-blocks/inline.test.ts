/**
 * Inline formatting -> rich text elements.
 */

import { describe, expect, test } from "vitest";
import { markdownToSlackBlocks } from "./index.js";
import { escapeMrkdwn, parseInline } from "./inline.js";
import { textOf } from "./helpers.test-utils.js";

/** Parse a single paragraph and return its inline elements. */
function inline(md: string) {
  const blocks = markdownToSlackBlocks(md);
  const first = blocks[0];
  if (first?.type !== "rich_text") throw new Error(`expected rich_text, got ${first?.type}`);
  const section = first.elements[0];
  if (section?.type !== "rich_text_section") throw new Error("expected section");
  return section.elements;
}

describe("inline formatting", () => {
  test("bold, italic, bold+italic and strikethrough carry structural styles", () => {
    expect(inline("**b**")[0]).toMatchObject({ text: "b", style: { bold: true } });
    expect(inline("*i*")[0]).toMatchObject({ text: "i", style: { italic: true } });
    expect(inline("__b__")[0]).toMatchObject({ text: "b", style: { bold: true } });
    expect(inline("_i_")[0]).toMatchObject({ text: "i", style: { italic: true } });
    expect(inline("~~s~~")[0]).toMatchObject({ text: "s", style: { strike: true } });
    expect(inline("***bi***")[0]).toMatchObject({
      text: "bi",
      style: { bold: true, italic: true },
    });
  });

  test("nested emphasis composes rather than replacing the outer style", () => {
    const els = inline("**bold with *italic* inside**");
    const italicRun = els.find((e) => e.type === "text" && e.style?.italic === true);
    expect(italicRun).toMatchObject({ style: { bold: true, italic: true } });
  });

  test("inline code is a code-styled text element, not a backticked string", () => {
    const els = inline("run `npm test` now");
    const code = els.find((e) => e.type === "text" && e.style?.code === true);
    expect(code).toMatchObject({ text: "npm test", style: { code: true } });
    // The backticks themselves must not leak into the rendered text.
    expect(textOf(els)).toBe("run npm test now");
  });

  test("markdown inside a code span stays literal", () => {
    const els = inline("`**not bold**`");
    expect(els).toHaveLength(1);
    expect(els[0]).toMatchObject({ text: "**not bold**", style: { code: true } });
  });

  test("code spans can contain backticks via multi-backtick fences", () => {
    const els = inline("`` a ` b ``");
    expect(els[0]).toMatchObject({ text: "a ` b", style: { code: true } });
  });

  test("[text](url) becomes a link element with the label as text", () => {
    const els = inline("see [the docs](https://example.com/x)");
    const link = els.find((e) => e.type === "link");
    expect(link).toMatchObject({ type: "link", url: "https://example.com/x", text: "the docs" });
  });

  test("link URLs may contain balanced parentheses", () => {
    const els = inline("[wiki](https://en.wikipedia.org/wiki/Foo_(bar))");
    const link = els.find((e) => e.type === "link");
    expect(link).toMatchObject({ url: "https://en.wikipedia.org/wiki/Foo_(bar)" });
  });

  test("bare URLs become links without swallowing trailing punctuation", () => {
    const els = inline("go to https://example.com/a, now");
    const link = els.find((e) => e.type === "link");
    expect(link).toMatchObject({ type: "link", url: "https://example.com/a" });
    expect(textOf(els)).toContain(", now");
  });

  test("angle-bracket autolinks become links", () => {
    const els = inline("<https://example.com>");
    expect(els[0]).toMatchObject({ type: "link", url: "https://example.com" });
  });

  test(":emoji: becomes an emoji element", () => {
    const els = inline("ship it :rocket:");
    expect(els.find((e) => e.type === "emoji")).toMatchObject({ type: "emoji", name: "rocket" });
  });

  test("slack user and channel mentions survive as native elements", () => {
    const els = inline("cc <@U123ABC> in <#C456DEF|general>");
    expect(els.find((e) => e.type === "user")).toMatchObject({ user_id: "U123ABC" });
    expect(els.find((e) => e.type === "channel")).toMatchObject({ channel_id: "C456DEF" });
  });

  test("snake_case identifiers are not mangled into italics", () => {
    const els = inline("call my_var_name here");
    expect(textOf(els)).toBe("call my_var_name here");
    expect(els.some((e) => e.type === "text" && e.style?.italic === true)).toBe(false);
  });

  test("backslash escapes render the literal character", () => {
    const els = inline(String.raw`\*not italic\*`);
    expect(textOf(els)).toBe("*not italic*");
    expect(els.some((e) => e.type === "text" && e.style?.italic === true)).toBe(false);
  });

  test("adjacent identically-styled runs are merged into one element", () => {
    // Guards against emitting one element per character.
    const els = inline("plain text with no markup at all");
    expect(els).toHaveLength(1);
  });

  test("rich text is NOT html-escaped — & < > stay literal", () => {
    // Escaping belongs to mrkdwn strings; applying it to rich text would show
    // the user a literal "&amp;".
    const els = inline("a & b < c > d");
    expect(textOf(els)).toBe("a & b < c > d");
  });

  test("code spans are NOT escaped — no double-escaping of & < >", () => {
    // The rich text path carries no mrkdwn escaping at all; escaping code
    // content here would render a literal "&amp;" to the user.
    const els = inline("`a && b < c`");
    expect(els[0]).toMatchObject({ text: "a && b < c", style: { code: true } });
    expect(textOf(els)).not.toContain("&amp;");
    expect(textOf(els)).not.toContain("&lt;");
  });

  test("escapeMrkdwn escapes exactly the three control characters", () => {
    expect(escapeMrkdwn("a & b < c > d")).toBe("a &amp; b &lt; c &gt; d");
  });

  test("parseInline on empty input yields no elements", () => {
    expect(parseInline("")).toEqual([]);
  });

  test("unmatched emphasis markers stay literal instead of eating the line", () => {
    expect(textOf(inline("2 * 3 * 4 = 24"))).toContain("24");
    expect(textOf(inline("**unclosed bold"))).toBe("**unclosed bold");
  });
});
