import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import {
  LspClient,
  Hover,
  Location,
  CompletionItem,
  DocumentSymbol,
  SymbolInformation,
  severityToString,
} from "./lsp-client.js";

function filePathToUri(filePath: string): string {
  return pathToFileURL(path.resolve(filePath)).href;
}

function readFileContent(filePath: string): string {
  const absolute = path.resolve(filePath);
  try {
    return fs.readFileSync(absolute, "utf-8");
  } catch (err) {
    throw new Error(`Failed to read file '${absolute}': ${(err as Error).message}`);
  }
}

async function ensureDocumentOpen(
  client: LspClient,
  filePath: string
): Promise<string> {
  const uri = filePathToUri(filePath);
  const content = readFileContent(filePath);
  await client.openDocument(uri, content);
  // Give terraform-ls a moment to process the document
  await new Promise((r) => setTimeout(r, 500));
  return uri;
}

function formatHover(hover: Hover | null): string {
  if (!hover) return "No information available at this position.";

  const { contents } = hover;
  if (typeof contents === "string") return contents;
  if ("value" in contents) return contents.value;
  if (Array.isArray(contents)) {
    return contents
      .map((c) => (typeof c === "string" ? c : c.value))
      .join("\n\n");
  }
  return JSON.stringify(contents);
}

function formatLocations(locations: Location | Location[] | null): string {
  if (!locations) return "No definition found.";

  const locs = Array.isArray(locations) ? locations : [locations];
  if (locs.length === 0) return "No definition found.";

  return locs
    .map((loc) => {
      const file = fileURLToPath(loc.uri);
      const line = loc.range.start.line + 1;
      const col = loc.range.start.character + 1;
      return `${file}:${line}:${col}`;
    })
    .join("\n");
}

function formatCompletions(items: CompletionItem[]): string {
  if (items.length === 0) return "No completions available.";

  return items
    .slice(0, 50) // Limit output
    .map((item) => {
      let line = `- ${item.label}`;
      if (item.detail) line += ` — ${item.detail}`;
      if (item.documentation) {
        const doc =
          typeof item.documentation === "string"
            ? item.documentation
            : item.documentation.value;
        if (doc) line += `\n  ${doc.split("\n")[0]}`;
      }
      return line;
    })
    .join("\n");
}

const SYMBOL_KINDS: Record<number, string> = {
  1: "File", 2: "Module", 3: "Namespace", 4: "Package", 5: "Class",
  6: "Method", 7: "Property", 8: "Field", 9: "Constructor", 10: "Enum",
  11: "Interface", 12: "Function", 13: "Variable", 14: "Constant",
  15: "String", 16: "Number", 17: "Boolean", 18: "Array", 19: "Object",
  20: "Key", 21: "Null", 22: "EnumMember", 23: "Struct", 24: "Event",
  25: "Operator", 26: "TypeParameter",
};

function formatSymbols(
  symbols: DocumentSymbol[] | SymbolInformation[],
  indent = 0
): string {
  if (symbols.length === 0) return "No symbols found.";

  return symbols
    .map((sym) => {
      const prefix = "  ".repeat(indent);
      const kind = SYMBOL_KINDS[sym.kind] ?? "Unknown";

      if ("location" in sym) {
        // SymbolInformation
        const s = sym as SymbolInformation;
        const line = s.location.range.start.line + 1;
        return `${prefix}- ${s.name} (${kind}) line ${line}`;
      }

      // DocumentSymbol
      const ds = sym as DocumentSymbol;
      const line = ds.range.start.line + 1;
      let result = `${prefix}- ${ds.name} (${kind}) line ${line}`;
      if (ds.detail) result += ` — ${ds.detail}`;
      if (ds.children && ds.children.length > 0) {
        result += "\n" + formatSymbols(ds.children, indent + 1);
      }
      return result;
    })
    .join("\n");
}

export function registerTools(server: McpServer, client: LspClient): void {
  const fileArg = z.object({
    file: z.string().describe("Absolute path to the .tf file"),
  });

  const positionArgs = z.object({
    file: z.string().describe("Absolute path to the .tf file"),
    line: z.number().describe("Line number (1-based)"),
    character: z.number().describe("Column number (1-based)"),
  });

  server.tool(
    "terraform_hover",
    "Get documentation and type information for a Terraform symbol at a specific position",
    positionArgs.shape,
    async ({ file, line, character }) => {
      const uri = await ensureDocumentOpen(client, file);
      const hover = await client.hover(uri, {
        line: line - 1,
        character: character - 1,
      });
      return { content: [{ type: "text" as const, text: formatHover(hover) }] };
    }
  );

  server.tool(
    "terraform_definition",
    "Go to the definition of a Terraform symbol at a specific position",
    positionArgs.shape,
    async ({ file, line, character }) => {
      const uri = await ensureDocumentOpen(client, file);
      const result = await client.definition(uri, {
        line: line - 1,
        character: character - 1,
      });
      return {
        content: [{ type: "text" as const, text: formatLocations(result) }],
      };
    }
  );

  server.tool(
    "terraform_references",
    "Find all references to a Terraform symbol at a specific position",
    positionArgs.shape,
    async ({ file, line, character }) => {
      const uri = await ensureDocumentOpen(client, file);
      const result = await client.references(uri, {
        line: line - 1,
        character: character - 1,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: formatLocations(result ?? []),
          },
        ],
      };
    }
  );

  server.tool(
    "terraform_completion",
    "Get completions for Terraform code at a specific position",
    positionArgs.shape,
    async ({ file, line, character }) => {
      const uri = await ensureDocumentOpen(client, file);
      const items = await client.completion(uri, {
        line: line - 1,
        character: character - 1,
      });
      return {
        content: [{ type: "text" as const, text: formatCompletions(items) }],
      };
    }
  );

  server.tool(
    "terraform_diagnostics",
    "Get diagnostics (errors and warnings) for a Terraform file",
    fileArg.shape,
    async ({ file }) => {
      const uri = await ensureDocumentOpen(client, file);
      // Wait a bit longer for diagnostics to come in
      await new Promise((r) => setTimeout(r, 1500));
      const diags = client.getDiagnostics(uri);
      if (diags.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No diagnostics reported." }],
        };
      }
      const text = diags
        .map((d) => {
          const sev = severityToString(d.severity);
          const line = d.range.start.line + 1;
          const col = d.range.start.character + 1;
          return `[${sev}] ${d.message} (line ${line}:${col})${d.source ? ` [${d.source}]` : ""}`;
        })
        .join("\n");
      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "terraform_document_symbols",
    "List all symbols (resources, variables, outputs, etc.) in a Terraform file",
    fileArg.shape,
    async ({ file }) => {
      const uri = await ensureDocumentOpen(client, file);
      const symbols = await client.documentSymbols(uri);
      return {
        content: [{ type: "text" as const, text: formatSymbols(symbols) }],
      };
    }
  );

  server.tool(
    "terraform_format",
    "Format a Terraform file and return the formatted content",
    fileArg.shape,
    async ({ file }) => {
      const uri = await ensureDocumentOpen(client, file);
      const edits = await client.formatting(uri);
      if (edits.length === 0) {
        return {
          content: [
            { type: "text" as const, text: "File is already formatted." },
          ],
        };
      }

      // Apply edits to the content (normalize CRLF to LF)
      const content = readFileContent(file).replace(/\r\n/g, "\n");
      const lines = content.split("\n");

      // Apply edits in reverse order to preserve positions
      const sorted = [...edits].sort((a, b) => {
        if (a.range.start.line !== b.range.start.line)
          return b.range.start.line - a.range.start.line;
        return b.range.start.character - a.range.start.character;
      });

      let result = content;
      for (const edit of sorted) {
        const startOffset = positionToOffset(
          lines,
          edit.range.start.line,
          edit.range.start.character
        );
        const endOffset = positionToOffset(
          lines,
          edit.range.end.line,
          edit.range.end.character
        );
        result =
          result.substring(0, startOffset) +
          edit.newText +
          result.substring(endOffset);
      }

      return {
        content: [{ type: "text" as const, text: result }],
      };
    }
  );
}

function positionToOffset(
  lines: string[],
  line: number,
  character: number
): number {
  let offset = 0;
  for (let i = 0; i < line && i < lines.length; i++) {
    offset += lines[i].length + 1; // +1 for newline
  }
  return offset + character;
}
