import { describe, it, expect } from "vitest";
import { severityToString } from "../lsp-client.js";

describe("severityToString", () => {
  it("returns Error for severity 1", () => {
    expect(severityToString(1)).toBe("Error");
  });

  it("returns Warning for severity 2", () => {
    expect(severityToString(2)).toBe("Warning");
  });

  it("returns Information for severity 3", () => {
    expect(severityToString(3)).toBe("Information");
  });

  it("returns Hint for severity 4", () => {
    expect(severityToString(4)).toBe("Hint");
  });

  it("returns Unknown for undefined severity", () => {
    expect(severityToString(undefined)).toBe("Unknown");
  });

  it("returns Unknown for unmapped severity", () => {
    expect(severityToString(99)).toBe("Unknown");
  });
});
