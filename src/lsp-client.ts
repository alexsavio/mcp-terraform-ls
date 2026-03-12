import { spawn, ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import * as path from "node:path";

interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

export interface Position {
  line: number;
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export interface Location {
  uri: string;
  range: Range;
}

export interface Diagnostic {
  range: Range;
  severity?: number;
  code?: string | number;
  source?: string;
  message: string;
}

export interface CompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string | { kind: string; value: string };
  insertText?: string;
}

export interface DocumentSymbol {
  name: string;
  kind: number;
  range: Range;
  selectionRange: Range;
  detail?: string;
  children?: DocumentSymbol[];
}

export interface SymbolInformation {
  name: string;
  kind: number;
  location: Location;
  containerName?: string;
}

export interface Hover {
  contents: string | { kind: string; value: string } | Array<string | { language: string; value: string }>;
  range?: Range;
}

const SEVERITY_MAP: Record<number, string> = {
  1: "Error",
  2: "Warning",
  3: "Information",
  4: "Hint",
};

export function severityToString(severity: number | undefined): string {
  return severity ? SEVERITY_MAP[severity] ?? "Unknown" : "Unknown";
}

export class LspClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private buffer = "";
  private contentLength = -1;
  private initialized = false;
  private workspaceRoot: string | null = null;
  private openDocuments = new Set<string>();
  private diagnostics = new Map<string, Diagnostic[]>();
  private terraformLsPath: string;

  constructor() {
    super();
    this.terraformLsPath =
      process.env.TERRAFORM_LS_PATH || "terraform-ls";
  }

  async ensureInitialized(fileUri: string): Promise<void> {
    const workspaceRoot = this.resolveWorkspaceRoot(fileUri);

    if (this.initialized && this.workspaceRoot === workspaceRoot) {
      return;
    }

    if (this.initialized && this.workspaceRoot !== workspaceRoot) {
      await this.shutdown();
    }

    await this.initialize(workspaceRoot);
  }

  private resolveWorkspaceRoot(fileUri: string): string {
    // Walk up from the file to find a directory containing .tf files
    let dir = path.dirname(fileUri.replace("file://", ""));
    const root = path.parse(dir).root;

    while (dir !== root) {
      // Use the directory containing the .tf file as workspace root
      return dir;
    }

    return dir;
  }

  private async initialize(workspaceRoot: string): Promise<void> {
    this.workspaceRoot = workspaceRoot;

    this.process = spawn(this.terraformLsPath, ["serve"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.process.stdout!.on("data", (data: Buffer) => {
      this.handleData(data.toString());
    });

    this.process.stderr!.on("data", (data: Buffer) => {
      // Log terraform-ls stderr for debugging
      const msg = data.toString().trim();
      if (msg) {
        process.stderr.write(`[terraform-ls] ${msg}\n`);
      }
    });

    this.process.on("exit", (code) => {
      process.stderr.write(
        `[terraform-ls] exited with code ${code}\n`
      );
      this.initialized = false;
      this.process = null;
    });

    const initResult = await this.sendRequest("initialize", {
      processId: process.pid,
      rootUri: `file://${workspaceRoot}`,
      capabilities: {
        textDocument: {
          hover: { contentFormat: ["markdown", "plaintext"] },
          completion: {
            completionItem: {
              snippetSupport: false,
              documentationFormat: ["markdown", "plaintext"],
            },
          },
          synchronization: {
            didSave: true,
            willSave: false,
            willSaveWaitUntil: false,
          },
          publishDiagnostics: {
            relatedInformation: true,
          },
        },
        workspace: {
          workspaceFolders: true,
        },
      },
      workspaceFolders: [
        {
          uri: `file://${workspaceRoot}`,
          name: path.basename(workspaceRoot),
        },
      ],
    });

    await this.sendNotification("initialized", {});
    this.initialized = true;

    return initResult as void;
  }

  private handleData(data: string): void {
    this.buffer += data;

    while (true) {
      if (this.contentLength === -1) {
        const headerEnd = this.buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) return;

        const header = this.buffer.substring(0, headerEnd);
        const match = header.match(/Content-Length:\s*(\d+)/i);
        if (!match) {
          // Skip malformed header
          this.buffer = this.buffer.substring(headerEnd + 4);
          continue;
        }

        this.contentLength = parseInt(match[1], 10);
        this.buffer = this.buffer.substring(headerEnd + 4);
      }

      if (this.buffer.length < this.contentLength) return;

      const body = this.buffer.substring(0, this.contentLength);
      this.buffer = this.buffer.substring(this.contentLength);
      this.contentLength = -1;

      try {
        const message: JsonRpcMessage = JSON.parse(body);
        this.handleMessage(message);
      } catch {
        process.stderr.write(
          `[terraform-ls] Failed to parse JSON-RPC message\n`
        );
      }
    }
  }

  private handleMessage(message: JsonRpcMessage): void {
    // Handle notifications (no id)
    if (message.method && message.id === undefined) {
      if (message.method === "textDocument/publishDiagnostics") {
        const params = message.params as {
          uri: string;
          diagnostics: Diagnostic[];
        };
        this.diagnostics.set(params.uri, params.diagnostics);
        this.emit("diagnostics", params.uri, params.diagnostics);
      }
      return;
    }

    // Handle responses
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (pending) {
        this.pending.delete(message.id);
        if (message.error) {
          pending.reject(
            new Error(
              `LSP error ${message.error.code}: ${message.error.message}`
            )
          );
        } else {
          pending.resolve(message.result);
        }
      }
    }
  }

  private sendRequest(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin?.writable) {
        reject(new Error("terraform-ls process is not running"));
        return;
      }

      const id = this.nextId++;
      const message: JsonRpcMessage = {
        jsonrpc: "2.0",
        id,
        method,
        params,
      };

      this.pending.set(id, { resolve, reject });

      const body = JSON.stringify(message);
      const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
      this.process.stdin.write(header + body);
    });
  }

  private sendNotification(method: string, params: unknown): void {
    if (!this.process?.stdin?.writable) return;

    const message: JsonRpcMessage = {
      jsonrpc: "2.0",
      method,
      params,
    };

    const body = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
    this.process.stdin.write(header + body);
  }

  async openDocument(uri: string, text: string): Promise<void> {
    if (this.openDocuments.has(uri)) {
      // Send didChange instead
      this.sendNotification("textDocument/didChange", {
        textDocument: { uri, version: Date.now() },
        contentChanges: [{ text }],
      });
      return;
    }

    this.sendNotification("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId: "terraform",
        version: 1,
        text,
      },
    });
    this.openDocuments.add(uri);
  }

  async hover(uri: string, position: Position): Promise<Hover | null> {
    await this.ensureInitialized(uri);
    const result = await this.sendRequest("textDocument/hover", {
      textDocument: { uri },
      position,
    });
    return result as Hover | null;
  }

  async definition(
    uri: string,
    position: Position
  ): Promise<Location | Location[] | null> {
    await this.ensureInitialized(uri);
    const result = await this.sendRequest("textDocument/definition", {
      textDocument: { uri },
      position,
    });
    return result as Location | Location[] | null;
  }

  async references(
    uri: string,
    position: Position
  ): Promise<Location[] | null> {
    await this.ensureInitialized(uri);
    const result = await this.sendRequest("textDocument/references", {
      textDocument: { uri },
      position,
      context: { includeDeclaration: true },
    });
    return result as Location[] | null;
  }

  async completion(
    uri: string,
    position: Position
  ): Promise<CompletionItem[]> {
    await this.ensureInitialized(uri);
    const result = (await this.sendRequest("textDocument/completion", {
      textDocument: { uri },
      position,
    })) as { items?: CompletionItem[] } | CompletionItem[] | null;

    if (Array.isArray(result)) return result;
    if (result && "items" in result) return result.items ?? [];
    return [];
  }

  getDiagnostics(uri: string): Diagnostic[] {
    return this.diagnostics.get(uri) ?? [];
  }

  async documentSymbols(
    uri: string
  ): Promise<DocumentSymbol[] | SymbolInformation[]> {
    await this.ensureInitialized(uri);
    const result = await this.sendRequest("textDocument/documentSymbol", {
      textDocument: { uri },
    });
    return (result as DocumentSymbol[] | SymbolInformation[]) ?? [];
  }

  async formatting(uri: string): Promise<Array<{ range: Range; newText: string }>> {
    await this.ensureInitialized(uri);
    const result = await this.sendRequest("textDocument/formatting", {
      textDocument: { uri },
      options: { tabSize: 2, insertSpaces: true },
    });
    return (result as Array<{ range: Range; newText: string }>) ?? [];
  }

  async shutdown(): Promise<void> {
    if (!this.process) return;

    try {
      await this.sendRequest("shutdown", null);
      this.sendNotification("exit", null);
    } catch {
      // Process may already be dead
    }

    this.process.kill();
    this.process = null;
    this.initialized = false;
    this.openDocuments.clear();
    this.diagnostics.clear();
    this.pending.clear();
    this.buffer = "";
    this.contentLength = -1;
  }
}
