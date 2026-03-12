import { describe, it, expect } from "vitest";
import { pathToFileURL } from "node:url";
import {
  formatHover,
  formatLocations,
  formatCompletions,
  formatSymbols,
  positionToOffset,
} from "../tools.js";
import type {
  Hover,
  Location,
  CompletionItem,
  DocumentSymbol,
  SymbolInformation,
} from "../lsp-client.js";

describe("formatHover", () => {
  it("returns fallback for null", () => {
    expect(formatHover(null)).toBe("No information available at this position.");
  });

  it("formats a plain string", () => {
    const hover: Hover = { contents: "hello" };
    expect(formatHover(hover)).toBe("hello");
  });

  it("formats MarkupContent", () => {
    const hover: Hover = { contents: { kind: "markdown", value: "**bold**" } };
    expect(formatHover(hover)).toBe("**bold**");
  });

  it("formats an array of MarkedString", () => {
    const hover: Hover = {
      contents: ["plain", { language: "hcl", value: "resource {}" }],
    };
    expect(formatHover(hover)).toBe("plain\n\nresource {}");
  });
});

describe("formatLocations", () => {
  const makeLocation = (filePath: string, line: number, char: number): Location => ({
    uri: pathToFileURL(filePath).href,
    range: {
      start: { line, character: char },
      end: { line, character: char },
    },
  });

  it("returns fallback for null", () => {
    expect(formatLocations(null)).toBe("No definition found.");
  });

  it("returns fallback for empty array", () => {
    expect(formatLocations([])).toBe("No definition found.");
  });

  it("formats a single location", () => {
    const loc = makeLocation("/tmp/main.tf", 4, 2);
    const result = formatLocations(loc);
    expect(result).toBe("/tmp/main.tf:5:3");
  });

  it("formats an array of locations", () => {
    const locs = [makeLocation("/tmp/a.tf", 0, 0), makeLocation("/tmp/b.tf", 9, 5)];
    const result = formatLocations(locs);
    expect(result).toBe("/tmp/a.tf:1:1\n/tmp/b.tf:10:6");
  });
});

describe("formatCompletions", () => {
  it("returns fallback for empty array", () => {
    expect(formatCompletions([])).toBe("No completions available.");
  });

  it("formats items with label only", () => {
    const items: CompletionItem[] = [{ label: "aws_instance" }];
    expect(formatCompletions(items)).toBe("- aws_instance");
  });

  it("formats items with detail and documentation", () => {
    const items: CompletionItem[] = [
      {
        label: "aws_instance",
        detail: "Resource",
        documentation: "Creates an EC2 instance\nMore info here",
      },
    ];
    const result = formatCompletions(items);
    expect(result).toBe("- aws_instance — Resource\n  Creates an EC2 instance");
  });

  it("formats MarkupContent documentation", () => {
    const items: CompletionItem[] = [
      {
        label: "var",
        documentation: { kind: "markdown", value: "A variable" },
      },
    ];
    expect(formatCompletions(items)).toBe("- var\n  A variable");
  });

  it("truncates at 50 items", () => {
    const items: CompletionItem[] = Array.from({ length: 60 }, (_, i) => ({
      label: `item${i}`,
    }));
    const lines = formatCompletions(items).split("\n");
    expect(lines).toHaveLength(50);
  });
});

describe("formatSymbols", () => {
  it("returns fallback for empty array", () => {
    expect(formatSymbols([])).toBe("No symbols found.");
  });

  it("formats SymbolInformation", () => {
    const syms: SymbolInformation[] = [
      {
        name: "aws_instance.web",
        kind: 5, // Class
        location: {
          uri: "file:///tmp/main.tf",
          range: {
            start: { line: 2, character: 0 },
            end: { line: 10, character: 1 },
          },
        },
      },
    ];
    expect(formatSymbols(syms)).toBe("- aws_instance.web (Class) line 3");
  });

  it("formats DocumentSymbol with children", () => {
    const syms: DocumentSymbol[] = [
      {
        name: "resource",
        kind: 2, // Module
        range: { start: { line: 0, character: 0 }, end: { line: 5, character: 1 } },
        selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 8 } },
        detail: "aws_instance",
        children: [
          {
            name: "ami",
            kind: 8, // Field
            range: { start: { line: 1, character: 2 }, end: { line: 1, character: 20 } },
            selectionRange: { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } },
          },
        ],
      },
    ];
    const result = formatSymbols(syms);
    expect(result).toBe("- resource (Module) line 1 — aws_instance\n  - ami (Field) line 2");
  });
});

describe("positionToOffset", () => {
  it("calculates offset for first line", () => {
    const lines = ["hello", "world"];
    expect(positionToOffset(lines, 0, 3)).toBe(3);
  });

  it("calculates offset for second line", () => {
    const lines = ["hello", "world"];
    // line 0 = "hello" (5 chars + 1 newline = 6), then char 2
    expect(positionToOffset(lines, 1, 2)).toBe(8);
  });

  it("calculates offset for empty lines", () => {
    const lines = ["", "abc"];
    // line 0 = "" (0 chars + 1 newline = 1), then char 0
    expect(positionToOffset(lines, 1, 0)).toBe(1);
  });
});
