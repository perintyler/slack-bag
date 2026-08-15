export type { SlackResponseBody, ResponseUrlPoster } from "@barry-rocks/slack/commands";

import type { SlackResponseBody, ResponseUrlPoster } from "@barry-rocks/slack/commands";

export function createResponseUrlPoster(responseUrl: string): ResponseUrlPoster {
  return async (body: SlackResponseBody): Promise<void> => {
    const res = await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`slack: response_url POST failed: ${res.status} ${await res.text()}`);
    }
  };
}
