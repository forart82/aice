/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Official Visual Studio Code & Cursor Extension Client for AIL 2.0.
 * Connects to the AIL Language Server Protocol (LSP) Daemon over stdio.
 */

const vscode = require("vscode");
const { spawn } = require("node:child_process");
const path = require("node:path");

let lspProcess = null;
let diagnosticCollection = null;
let messageBuffer = Buffer.alloc(0);
let nextRequestId = 1;
const pendingRequests = new Map();

function activate(context) {
  diagnosticCollection = vscode.languages.createDiagnosticCollection("ail");
  context.subscriptions.push(diagnosticCollection);

  // 1. Locate LSP server executable
  const serverProcess = spawnLspServer(context);
  if (!serverProcess) return;

  lspProcess = serverProcess;

  lspProcess.stdout.on("data", (chunk) => {
    handleServerData(chunk);
  });

  lspProcess.stderr.on("data", (data) => {
    console.error(`[AIL LSP] ${data.toString()}`);
  });

  lspProcess.on("close", (code) => {
    console.log(`[AIL LSP] Process exited with code ${code}`);
  });

  // 2. Initialize LSP Handshake
  sendRequest("initialize", {
    capabilities: {
      textDocument: {
        hover: { dynamicRegistration: true },
        completion: { dynamicRegistration: true },
      },
    },
  });

  sendNotification("initialized", {});

  // 3. Document Lifecycle Notifications
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (doc.languageId === "ail") {
        sendNotification("textDocument/didOpen", {
          textDocument: {
            uri: doc.uri.toString(),
            languageId: "ail",
            version: doc.version,
            text: doc.getText(),
          },
        });
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.languageId === "ail") {
        sendNotification("textDocument/didChange", {
          textDocument: {
            uri: event.document.uri.toString(),
            version: event.document.version,
          },
          contentChanges: [{ text: event.document.getText() }],
        });
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (doc.languageId === "ail") {
        diagnosticCollection.delete(doc.uri);
        sendNotification("textDocument/didClose", {
          textDocument: { uri: doc.uri.toString() },
        });
      }
    })
  );

  // 4. Hover Provider
  context.subscriptions.push(
    vscode.languages.registerHoverProvider("ail", {
      provideHover(document, position) {
        return sendRequest("textDocument/hover", {
          textDocument: { uri: document.uri.toString() },
          position: { line: position.line, character: position.character },
        }).then((res) => {
          if (!res || !res.contents) return null;
          const markdown = typeof res.contents === "string" ? res.contents : res.contents.value;
          return new vscode.Hover(new vscode.MarkdownString(markdown));
        });
      },
    })
  );

  // 5. Completion Item Provider
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      "ail",
      {
        provideCompletionItems(document, position) {
          return sendRequest("textDocument/completion", {
            textDocument: { uri: document.uri.toString() },
            position: { line: position.line, character: position.character },
          }).then((items) => {
            if (!items || !Array.isArray(items)) return [];
            return items.map((item) => {
              const ci = new vscode.CompletionItem(item.label);
              ci.detail = item.detail;
              if (item.insertText) {
                ci.insertText = new vscode.SnippetString(item.insertText);
              }
              return ci;
            });
          });
        },
      },
      ".",
      ":",
      " "
    )
  );

  // Sync any already open AIL documents
  for (const doc of vscode.workspace.textDocuments) {
    if (doc.languageId === "ail") {
      sendNotification("textDocument/didOpen", {
        textDocument: {
          uri: doc.uri.toString(),
          languageId: "ail",
          version: doc.version,
          text: doc.getText(),
        },
      });
    }
  }
}

function spawnLspServer(context) {
  // Check workspace for local ail daemon
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders && workspaceFolders.length > 0) {
    const rootPath = workspaceFolders[0].uri.fsPath;
    const lspScript = path.join(rootPath, "bin", "ail-lsp.ts");
    return spawn("bun", [lspScript], { cwd: rootPath });
  }

  // Fallback to globally available ail lsp
  return spawn("ail", ["lsp"]);
}

function sendNotification(method, params) {
  if (!lspProcess) return;
  const msg = { jsonrpc: "2.0", method, params };
  writeMessage(msg);
}

function sendRequest(method, params) {
  return new Promise((resolve, reject) => {
    if (!lspProcess) {
      resolve(null);
      return;
    }
    const id = nextRequestId++;
    pendingRequests.set(id, { resolve, reject });
    const msg = { jsonrpc: "2.0", id, method, params };
    writeMessage(msg);
  });
}

function writeMessage(msg) {
  const json = JSON.stringify(msg);
  const len = Buffer.byteLength(json, "utf-8");
  const frame = `Content-Length: ${len}\r\n\r\n${json}`;
  lspProcess.stdin.write(frame);
}

function handleServerData(chunk) {
  messageBuffer = Buffer.concat([messageBuffer, chunk]);

  while (true) {
    const idx = messageBuffer.indexOf("\r\n\r\n");
    if (idx === -1) break;

    const header = messageBuffer.subarray(0, idx).toString("utf-8");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      messageBuffer = messageBuffer.subarray(idx + 4);
      continue;
    }

    const length = Number.parseInt(match[1], 10);
    const start = idx + 4;
    const end = start + length;

    if (messageBuffer.length < end) break;

    const payload = messageBuffer.subarray(start, end).toString("utf-8");
    messageBuffer = messageBuffer.subarray(end);

    try {
      const msg = JSON.parse(payload);
      handleMessage(msg);
    } catch (e) {
      console.error("[AIL LSP] JSON parse error:", e);
    }
  }
}

function handleMessage(msg) {
  // Handle responses to requests
  if (msg.id !== undefined && pendingRequests.has(msg.id)) {
    const { resolve, reject } = pendingRequests.get(msg.id);
    pendingRequests.delete(msg.id);
    if (msg.error) {
      reject(new Error(msg.error.message));
    } else {
      resolve(msg.result);
    }
    return;
  }

  // Handle server notifications
  if (msg.method === "textDocument/publishDiagnostics") {
    const { uri, diagnostics } = msg.params;
    const targetUri = vscode.Uri.parse(uri);
    const vscodeDiagnostics = diagnostics.map((d) => {
      const range = new vscode.Range(
        new vscode.Position(d.range.start.line, d.range.start.character),
        new vscode.Position(d.range.end.line, d.range.end.character)
      );
      const diag = new vscode.Diagnostic(range, d.message, vscode.DiagnosticSeverity.Error);
      diag.code = d.code;
      diag.source = d.source || "ail";
      return diag;
    });

    diagnosticCollection.set(targetUri, vscodeDiagnostics);
  }
}

function deactivate() {
  if (lspProcess) {
    lspProcess.kill();
  }
}

module.exports = {
  activate,
  deactivate,
};
