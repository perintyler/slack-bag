interface SlackContext {
  userName: string;
  channelName: string;
}

export function barryPrompt(prompt: string, ctx: SlackContext): string {
  return [
    `This session was started from Slack by @${ctx.userName} in #${ctx.channelName}.`,
    "",
    prompt,
  ].join("\n");
}

export function investigatePrompt(topic: string, ctx: SlackContext): string {
  return [
    `This session was started from Slack by @${ctx.userName} in #${ctx.channelName}.`,
    "",
    "You are conducting a thorough investigation. Research the topic deeply,",
    "verify claims, cross-reference sources, and produce a structured report",
    "with clear findings and evidence.",
    "",
    `Topic: ${topic}`,
  ].join("\n");
}

export function loopPrompt(task: string, ctx: SlackContext): string {
  return [
    `This session was started from Slack by @${ctx.userName} in #${ctx.channelName}.`,
    "",
    "You are running a loop task. Execute the task, check for completion,",
    "and repeat until done. Report status periodically.",
    "",
    `Task: ${task}`,
  ].join("\n");
}
