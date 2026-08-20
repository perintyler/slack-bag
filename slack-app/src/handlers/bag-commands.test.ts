import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Covers the bag-command loader, which had no tests despite being the path
 * every bag-provided Slack command arrives through.
 *
 * The registry snapshot is mocked so these stay hermetic — the real one reads
 * a generated JSON file whose contents depend on which bags the machine has
 * installed.
 */

const snapshot = vi.hoisted(() => ({ bags: [] as unknown[] }));

vi.mock("@barry-rocks/bags", () => ({
  loadBagRegistrySnapshot: async () => snapshot,
  checkBagRequirements: () => [],
}));

const { loadBagCommands } = await import("./bag-commands.js");

/** A bag whose entry module is this test file's fixture export. */
function bagDeclaring(commands: Array<{ name: string; description: string }>, entry: string) {
  return {
    name: "fixture-bag",
    source: { type: "local", path: new URL(".", import.meta.url).pathname },
    manifest: { slashCommands: { entry, commands } },
  };
}

beforeEach(() => {
  snapshot.bags = [];
});

describe("loadBagCommands", () => {
  it("returns nothing when no bag declares slash commands", async () => {
    snapshot.bags = [{ name: "plain", source: { type: "local", path: "/tmp" }, manifest: {} }];
    expect(await loadBagCommands()).toEqual({});
  });

  it("skips bags that are not local — a remote bag must not run code here", async () => {
    snapshot.bags = [{
      name: "remote",
      source: { type: "remote", url: "https://example.test" },
      manifest: { slashCommands: { entry: "x.ts", commands: [{ name: "a", description: "d" }] } },
    }];
    expect(await loadBagCommands()).toEqual({});
  });

  it("skips a bag whose entry file is missing rather than throwing", async () => {
    snapshot.bags = [bagDeclaring([{ name: "ghost", description: "d" }], "does-not-exist.ts")];
    expect(await loadBagCommands()).toEqual({});
  });

  it("carries the manifest description alongside the handler", async () => {
    // The regression this guards: the loader used to return bare handlers, so
    // getRegisteredCommands() reported "" for every bag command and diverged
    // from the manifest generator.
    snapshot.bags = [bagDeclaring(
      [{ name: "fixtureCommand", description: "A described command" }],
      "bag-commands.fixture.ts",
    )];
    const loaded = await loadBagCommands();
    expect(Object.keys(loaded)).toEqual(["fixtureCommand"]);
    expect(loaded.fixtureCommand?.description).toBe("A described command");
    expect(typeof loaded.fixtureCommand?.handler).toBe("function");
  });

  it("skips a declared command with no matching export", async () => {
    snapshot.bags = [bagDeclaring(
      [{ name: "notExported", description: "d" }],
      "bag-commands.fixture.ts",
    )];
    expect(await loadBagCommands()).toEqual({});
  });
});
