/**
 * The `slack-me` trait is a grant plus a deny-list, and a deny-list cannot say
 * "only this one". So the dangerous state is silent: add a write tool that
 * takes a `channel`, and the trait grants it the moment it exists — nothing
 * errors, nothing logs, and the trait still *looks* like "DM only yourself".
 *
 * These tests are the allow-list the scope format cannot express. Adding a
 * write tool to the slack namespace fails the first one until it is either
 * denied in `slack-self-dm-only` or consciously declared destination-free.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as tools from "./tools.js";

interface ToolDef {
  name: string;
  namespace: string;
  access: "read" | "write";
  schema?: Record<string, unknown>;
}

// Narrowed by hand rather than with a type predicate: the real ToolDefinition
// is generic over each tool's zod schema, so a predicate onto a common shape is
// not assignable to it. Reading the four fields off is enough, and keeps this
// test from having to name a dozen generic instantiations.
const slackTools: ToolDef[] = Object.values(tools)
  .map((t) => t as unknown as ToolDef)
  .filter((t) => t?.namespace === "slack");

/** The single write tool the trait is built to keep. */
const SELF_DM = "send_slack_message_to_self";

/** Write tools the scope denies. Kept in sync with config/scopes.builtin.yaml. */
const DENIED = ["send_slack_message", "send_message_as_user", "pretty_slacker"];

const manifestText = readFileSync(resolve(import.meta.dirname, "../bag.yaml"), "utf-8");

/**
 * Read one key out of the `slack-me:` trait block. A YAML parser is not a
 * dependency of this bag and adding one to read four scalar lines is a worse
 * trade than this — but it must not silently match nothing, so a key it cannot
 * find throws rather than returning undefined and passing a `toEqual` against
 * an equally-undefined expectation.
 */
function traitField(key: string): string {
  const block = manifestText.split(/^  slack-me:$/m)[1];
  if (!block) throw new Error("slack-me trait block not found in bag.yaml");
  const match = block.match(new RegExp(`^    ${key}: (.+)$`, "m"));
  if (!match) throw new Error(`slack-me trait has no \`${key}\` key`);
  return match[1].trim();
}

describe("slack-me trait", () => {
  it("sees every write tool in the namespace as either denied or the self-DM one", () => {
    const writeTools = slackTools.filter((t) => t.access === "write").map((t) => t.name).sort();
    expect(writeTools).toEqual([...DENIED, SELF_DM].sort());
  });

  it("keeps the self-DM tool free of any destination parameter", () => {
    // This is what makes the tool safe to grant: the channel comes from
    // auth.test at runtime, so a caller has no field to redirect it with.
    const selfDm = slackTools.find((t) => t.name === SELF_DM);
    expect(selfDm).toBeDefined();
    const params = Object.keys(selfDm?.schema ?? {});
    expect(params).not.toContain("channel");
    expect(params).not.toContain("user");
    expect(params.sort()).toEqual(["message", "thread_ts"]);
  });

  it("grants only the slack namespace, never composed slackbot", () => {
    // slackbot carries slack_post_message and slack_open_conversation, both of
    // which reach anyone. Composition would grant them silently.
    expect(traitField("bags")).toBe("[slack]");
  });

  it("stays readwrite with the narrowing scope attached", () => {
    // read would drop the self-DM tool (filterTools cuts write tools under a
    // read grant); dropping the scope would grant every write tool.
    expect(traitField("access")).toBe("readwrite");
    expect(traitField("scopes")).toBe("[slack-self-dm-only]");
  });
});
