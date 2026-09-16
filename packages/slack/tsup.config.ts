import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/commands.ts",
    "src/slack-service.ts",
    "src/slack-messaging-service.ts",
    "src/relevance-service.ts",
  ],
  format: ["esm"],
  dts: true,
  clean: true,
  outDir: "dist",
});
