#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { LspClient } from "./lsp-client.js";
import { registerTools } from "./tools.js";

const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "..", "package.json"), "utf-8")
) as { version: string };
const { version } = pkg;

async function main(): Promise<void> {
  const client = new LspClient();

  const server = new McpServer({
    name: "mcp-terraform-ls",
    version,
  });

  registerTools(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Graceful shutdown
  process.on("SIGINT", async () => {
    await client.shutdown();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await client.shutdown();
    process.exit(0);
  });
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err}\n`);
  process.exit(1);
});
