/**
 * Entry-module fixture for bag-commands.test.ts.
 *
 * The loader imports a bag's declared entry file and looks for a named export
 * per command, so exercising it needs a real module on disk.
 */

/** Matches the `fixtureCommand` command declared in the test's fake manifest. */
export const fixtureCommand = () => ({
  ack: { response_type: "ephemeral" as const, text: "ok" },
});
