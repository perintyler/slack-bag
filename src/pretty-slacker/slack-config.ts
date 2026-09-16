/**
 * Slack identity configuration for the pretty_slacker tool.
 *
 * This is a TypeScript module rather than a YAML file on purpose. It lived in
 * the barry monorepo at `config/slack.yaml` and was located by walking up from
 * this file — or from a hardcoded `~/repos/barry` fallback — and read at
 * runtime. Two things were wrong with that. It coupled this bag to another
 * repo's directory layout, and the read was wrapped in a bare try/catch that
 * returned "user" on any failure, so a moved or missing file meant `default:`
 * silently stopped being honored and messages went out as the wrong identity.
 *
 * The bag is bundled to a single flat `tools.js` in a build cache, so a data
 * file beside this module would NOT ship with it — resolving one at runtime
 * reintroduces exactly that silent failure. As a module it is inlined by the
 * bundler: there is no path to resolve and no file that can go missing.
 *
 * No tokens live here. The token names below are resolved from the session
 * profile at call time.
 */

export type SlackIdentity = "user" | "bot";

/** Identity used when a call does not pass one explicitly. */
export const DEFAULT_IDENTITY: SlackIdentity = "user";

/** Which profile secret backs each identity. */
export const IDENTITY_TOKENS: Record<SlackIdentity, string> = {
  user: "SLACK_USER_TOKEN",
  bot: "SLACK_BOT_TOKEN",
};

/** Human-readable description of each identity, for tool help text. */
export const IDENTITY_DESCRIPTIONS: Record<SlackIdentity, string> = {
  user: "Tyler's Slack account (sends as you)",
  bot: "Barry bot account",
};

export function loadDefaultIdentity(): SlackIdentity {
  return DEFAULT_IDENTITY;
}
