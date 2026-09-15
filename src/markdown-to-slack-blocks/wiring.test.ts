/**
 * The pretty-slacker wiring must fail LOUDLY.
 *
 * The previous implementation dynamic-imported a converter behind a bare
 * `catch` and silently fell back to a much weaker built-in. Messages kept
 * sending with degraded formatting and nothing surfaced the failure, so a
 * broken converter could ship unnoticed. These tests pin the new contract.
 */

import { describe, expect, test, vi } from "vitest";
import { markdownToBlocks, plainTextFallback } from "../pretty-slacker/md-to-blocks.js";
import * as converter from "./index.js";

describe("pretty-slacker markdown->blocks wiring", () => {
  test("uses the native converter, producing structural blocks", async () => {
    const blocks = await markdownToBlocks("# Title\n\n- a\n- b\n\n| x | y |\n|---|---|\n| 1 | 2 |");
    expect(blocks.some((b) => b.type === "header")).toBe(true);
    expect(blocks.some((b) => b.type === "table")).toBe(true);
    // The weak fallback emitted only section/header/divider; a rich_text block
    // proves we are on the native path.
    expect(blocks.some((b) => b.type === "rich_text")).toBe(true);
  });

  test("does NOT silently degrade to mrkdwn sections for lists", async () => {
    const blocks = await markdownToBlocks("- alpha\n- beta");
    const json = JSON.stringify(blocks);
    // The old fallback rewrote bullets as "• alpha" inside a section.
    expect(json).not.toContain("•");
    expect(blocks.some((b) => b.type === "section")).toBe(false);
  });

  test("a converter failure THROWS instead of falling back", async () => {
    const spy = vi
      .spyOn(converter, "markdownToSlackBlocks")
      .mockImplementation(() => {
        throw new Error("boom");
      });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(markdownToBlocks("# hi")).rejects.toThrow(/conversion failed/i);
      // And it is logged explicitly, not swallowed.
      expect(errSpy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      errSpy.mockRestore();
    }
  });

  test("the thrown error preserves the underlying cause", async () => {
    const original = new Error("root cause");
    const spy = vi.spyOn(converter, "markdownToSlackBlocks").mockImplementation(() => {
      throw original;
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await markdownToBlocks("# hi");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).cause).toBe(original);
    } finally {
      spy.mockRestore();
      errSpy.mockRestore();
    }
  });

  test("the plain-text fallback keeps link labels and strips markup", () => {
    const text = plainTextFallback("# Title\n\nSee [the docs](https://example.com) now");
    expect(text).toContain("Title");
    expect(text).toContain("the docs");
    // Markup characters must not leak into the notification text.
    expect(text).not.toContain("#");
    expect(text).not.toContain("](");
  });

  test("the plain-text fallback escapes mrkdwn control characters", () => {
    expect(plainTextFallback("a & b < c")).toBe("a &amp; b &lt; c");
  });

  test("the fallback strips table scaffolding and fence markers", () => {
    const text = plainTextFallback("| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\ncode\n```");
    expect(text).not.toContain("|---|");
    expect(text).not.toContain("```");
    expect(text).toContain("a | b");
    expect(text).toContain("code");
  });
});
