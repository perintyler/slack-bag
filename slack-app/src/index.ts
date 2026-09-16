import cors from "cors";
import express from "express";
import type { Request } from "express";

import { getServicePort } from "@barry-rocks/env";

import { initCommandHandlers } from "./handlers/index.js";
import { commandsRouter } from "./routes/commands.js";
import { eventsRouter } from "./routes/events.js";
import { mentionsRouter } from "./routes/mentions.js";

const app = express();
app.use(cors());

// Capture raw body for Slack signature verification.
// Slack slash commands send application/x-www-form-urlencoded;
// Events API sends application/json. Both need raw body access.
app.use(
  express.json({
    verify: (req: Request, _res, buf) => {
      (req as Request & { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);
app.use(
  express.urlencoded({
    extended: true,
    verify: (req: Request, _res, buf) => {
      (req as Request & { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Slack webhook endpoints
app.use("/slack/commands", commandsRouter);
app.use("/slack/events", eventsRouter);

// Internal API for mention retrieval (used by bag tool).
//
// "Internal" was only ever true of the caller, never of the route: this
// service is published on the shared tunnel at slack.barry.rocks, and until
// this guard existed a plain curl from anywhere on the internet returned the
// mention store — message text, channel and user IDs, display names. The
// webhook routes beside it verify Slack's HMAC; this one verified nothing.
//
// Cloudflare Access is the wrong instrument here (Slack and GitHub cannot
// complete an interactive login, and the same origin serves their webhooks),
// so the guard is the shared BARRY_SECRET the bag tool already holds. It
// fails closed: no secret configured means nothing is authorized, rather than
// everything.
app.use("/api/mentions", (req, res, next) => {
  const secret = process.env.BARRY_SECRET ?? "";
  if (!secret) {
    console.error("slack: BARRY_SECRET not configured — refusing /api/mentions");
    res.status(503).json({ error: "server secret not configured" });
    return;
  }
  const header = req.headers.authorization;
  if (header === `Bearer ${secret}` || req.headers["x-barry-secret"] === secret) {
    next();
    return;
  }
  res.status(403).json({ error: "forbidden" });
}, mentionsRouter);

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : getServicePort("slack");

await initCommandHandlers();

app.listen(PORT, "127.0.0.1", () => {
  console.warn(`slack server listening on http://127.0.0.1:${PORT}`);
});
