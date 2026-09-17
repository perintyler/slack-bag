import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@barry-rocks/env", () => ({ getServicePort: () => 4854 }));

const { notifyEvent } = await import("./notify-event.js");

const OK = { ok: true, status: 200 } as Response;

describe("notifyEvent", () => {
  beforeEach(() => {
    vi.stubEnv("BARRY_SECRET", "test_secret");
    vi.restoreAllMocks();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("posts a notification event to the barry API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(OK);
    vi.stubGlobal("fetch", fetchMock);

    const sent = await notifyEvent({
      kind: "im", userName: "rem", channelName: "D123", text: "hey barry",
    });

    expect(sent).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:4854/api/v1/events");
    const body = JSON.parse(init.body);
    expect(body.type).toBe("notification");
    expect(body.source).toBe("slack-app");
    expect(body.data.kind).toBe("im");
  });

  it("authenticates with BARRY_SECRET — the API 403s without it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(OK);
    vi.stubGlobal("fetch", fetchMock);
    await notifyEvent({ kind: "im", userName: "rem", channelName: "D1", text: "hi" });
    expect(fetchMock.mock.calls[0][1].headers["x-barry-secret"]).toBe("test_secret");
  });

  it("titles a DM distinctly from a channel mention", async () => {
    const fetchMock = vi.fn().mockResolvedValue(OK);
    vi.stubGlobal("fetch", fetchMock);

    await notifyEvent({ kind: "im", userName: "rem", channelName: "D1", text: "ship it" });
    await notifyEvent({ kind: "mention", userName: "sam", channelName: "eng", text: "<@U09G42JV83W> look" });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).title).toBe("rem (DM): ship it");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).title).toBe("sam (#eng): look");
  });

  it("falls back to a readable title when the text is only a bot mention", async () => {
    const fetchMock = vi.fn().mockResolvedValue(OK);
    vi.stubGlobal("fetch", fetchMock);
    await notifyEvent({ kind: "mention", userName: "sam", channelName: "eng", text: "<@U09G42JV83W>" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).title).toBe("sam sent a mention in #eng");
  });

  it("reports failure instead of throwing when the API rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 } as Response));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(notifyEvent({ kind: "im", userName: "r", channelName: "D1", text: "x" }))
      .resolves.toBe(false);
    expect(errors).toHaveBeenCalled();
  });

  it("reports failure instead of throwing when the API is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(notifyEvent({ kind: "im", userName: "r", channelName: "D1", text: "x" }))
      .resolves.toBe(false);
  });

  it("refuses to call the API when BARRY_SECRET is missing", async () => {
    vi.stubEnv("BARRY_SECRET", "");
    const fetchMock = vi.fn().mockResolvedValue(OK);
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await notifyEvent({ kind: "im", userName: "r", channelName: "D1", text: "x" })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/**
 * The mocked-fetch tests above cannot catch a payload the real API rejects:
 * they never see its schema. A `body: null` shipped and 400'd for exactly that
 * reason, so this validates against the contract schema the API itself uses.
 */
describe("payload matches the API contract", () => {
  beforeEach(() => vi.stubEnv("BARRY_SECRET", "test_secret"));
  afterEach(() => vi.unstubAllEnvs());

  async function capturePayload(input: Parameters<typeof notifyEvent>[0]) {
    const fetchMock = vi.fn().mockResolvedValue(OK);
    vi.stubGlobal("fetch", fetchMock);
    await notifyEvent(input);
    return JSON.parse(fetchMock.mock.calls[0][1].body);
  }

  it("validates for a DM with no permalink", async () => {
    const { CreateEventRequestSchema } = await import("@barry-rocks/contracts");
    const payload = await capturePayload({
      kind: "im", userName: "rem", channelName: "D1", text: "hey",
    });
    const result = CreateEventRequestSchema.safeParse(payload);
    expect(result.error?.issues ?? []).toEqual([]);
    expect(result.success).toBe(true);
  });

  it("validates for a channel mention with a permalink", async () => {
    const { CreateEventRequestSchema } = await import("@barry-rocks/contracts");
    const payload = await capturePayload({
      kind: "mention", userName: "sam", channelName: "eng",
      text: "<@U09G42JV83W> ping", permalink: "https://slack.com/archives/C1/p1",
    });
    const result = CreateEventRequestSchema.safeParse(payload);
    expect(result.error?.issues ?? []).toEqual([]);
    expect(result.success).toBe(true);
  });
});
