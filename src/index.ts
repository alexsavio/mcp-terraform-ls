#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { LspClient } from "./lsp-client.js";
import { registerTools } from "./tools.js";

async function main(): Promise<void> {
  const client = new LspClient();

  const server = new McpServer({
    name: "mcp-terraform-ls",
    version: "0.1.0",
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
