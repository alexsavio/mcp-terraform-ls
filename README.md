# mcp-terraform-ls

[![CI](https://github.com/alexsavio/mcp-terraform-ls/actions/workflows/ci.yml/badge.svg)](https://github.com/alexsavio/mcp-terraform-ls/actions/workflows/ci.yml)
[![Release](https://github.com/alexsavio/mcp-terraform-ls/actions/workflows/release.yml/badge.svg)](https://github.com/alexsavio/mcp-terraform-ls/actions/workflows/release.yml)
[![GitHub Release](https://img.shields.io/github/v/release/alexsavio/mcp-terraform-ls)](https://github.com/alexsavio/mcp-terraform-ls/releases/latest)

An MCP (Model Context Protocol) server that wraps [terraform-ls](https://github.com/hashicorp/terraform-ls), exposing Terraform language intelligence as MCP tools. This enables AI assistants like Claude Code to understand and navigate Terraform codebases.

## Prerequisites

- Node.js >= 20
- [terraform-ls](https://github.com/hashicorp/terraform-ls) installed

Install terraform-ls:
```bash
# macOS
brew install hashicorp/tap/terraform-ls

# Or download from https://github.com/hashicorp/terraform-ls/releases
```

## Installation

### From GitHub Releases

Download the latest `.tgz` package from the [releases page](https://github.com/alexsavio/mcp-terraform-ls/releases/latest) and install it globally:

```bash
npm install -g https://github.com/alexsavio/mcp-terraform-ls/releases/latest/download/mcp-terraform-ls-<version>.tgz
```

Or download the tarball first and install locally:

```bash
# Download
curl -LO https://github.com/alexsavio/mcp-terraform-ls/releases/latest/download/mcp-terraform-ls-<version>.tgz

# Install globally
npm install -g mcp-terraform-ls-<version>.tgz
```

Replace `<version>` with the actual version number (e.g., `2026.3.0`).

### From source

```bash
git clone https://github.com/alexsavio/mcp-terraform-ls.git
cd mcp-terraform-ls
npm install
npm run build
npm link
```

## Usage with Claude Code

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "terraform": {
      "command": "npx",
      "args": ["-y", "mcp-terraform-ls"]
    }
  }
}
```

If you installed from a GitHub Release, you can reference the binary directly:

```json
{
  "mcpServers": {
    "terraform": {
      "command": "mcp-terraform-ls"
    }
  }
}
```

Optionally set the `TERRAFORM_LS_PATH` environment variable if `terraform-ls` is not on your `PATH`.

## Available Tools

| Tool | Description |
|------|-------------|
| `terraform_hover` | Get documentation/type info for a symbol at a position |
| `terraform_definition` | Go to definition of a symbol |
| `terraform_references` | Find all references to a symbol |
| `terraform_completion` | Get completions at a position |
| `terraform_diagnostics` | Get diagnostics (errors/warnings) for a file |
| `terraform_document_symbols` | List all symbols in a file |
| `terraform_format` | Format a Terraform file |

### Tool Parameters

**Position-based tools** (`hover`, `definition`, `references`, `completion`):
- `file` — absolute path to the `.tf` file
- `line` — line number (1-based)
- `character` — column number (1-based)

**File-based tools** (`diagnostics`, `document_symbols`, `format`):
- `file` — absolute path to the `.tf` file

## How It Works

This server acts as a bridge between MCP (used by AI assistants) and LSP (used by terraform-ls):

1. Receives MCP tool calls from the AI assistant
2. Manages a terraform-ls subprocess via stdio
3. Translates MCP requests into LSP JSON-RPC calls
4. Returns formatted results back through MCP

The LSP client lazily initializes terraform-ls on the first tool call, using the file's directory as the workspace root.

## Development

```bash
npm install
npm run build
npm run dev  # watch mode
```

## License

MIT
