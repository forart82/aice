/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Official Visual Studio Code & Cursor Extension Client for AICE 2.0.
 * Connects to the AICE Language Server Protocol (LSP) Daemon over stdio.
 */

const vscode = require("vscode");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

let lspProcess = null;
let diagnosticCollection = null;
let outputChannel = null;
let aiceTerminal = null;
let statusBarItem = null;
let messageBuffer = Buffer.alloc(0);
let nextRequestId = 1;
const pendingRequests = new Map();

function activate(context) {
  diagnosticCollection = vscode.languages.createDiagnosticCollection("aice");
  context.subscriptions.push(diagnosticCollection);

  outputChannel = vscode.window.createOutputChannel("AICE Toolchain");
  context.subscriptions.push(outputChannel);

  // Status Bar Indicator
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = "$(zap) AICE";
  statusBarItem.tooltip = "AICE Language Support Active (Click to Compile)";
  statusBarItem.command = "aice.compile";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // 1. Locate LSP server executable
  const serverProcess = spawnLspServer(context);
  if (serverProcess) {
    lspProcess = serverProcess;

    lspProcess.stdout.on("data", (chunk) => {
      handleServerData(chunk);
    });

    lspProcess.stderr.on("data", (data) => {
      console.error(`[AICE LSP] ${data.toString()}`);
    });

    lspProcess.on("close", (code) => {
      console.log(`[AICE LSP] Process exited with code ${code}`);
    });

    // 2. Initialize LSP Handshake
    sendRequest("initialize", {
      capabilities: {
        textDocument: {
          hover: { dynamicRegistration: true },
          completion: { dynamicRegistration: true },
          formatting: { dynamicRegistration: true },
          documentSymbol: { dynamicRegistration: true },
          definition: { dynamicRegistration: true },
          codeAction: { dynamicRegistration: true },
        },
      },
    });

    sendNotification("initialized", {});

    // 3. Document Lifecycle Notifications
    context.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument((doc) => {
        if (doc.languageId === "aice") {
          sendNotification("textDocument/didOpen", {
            textDocument: {
              uri: doc.uri.toString(),
              languageId: "aice",
              version: doc.version,
              text: doc.getText(),
            },
          });
        }
      })
    );

    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.languageId === "aice") {
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
        if (doc.languageId === "aice") {
          diagnosticCollection.delete(doc.uri);
          sendNotification("textDocument/didClose", {
            textDocument: { uri: doc.uri.toString() },
          });
        }
      })
    );

    // 4. Hover Provider
    context.subscriptions.push(
      vscode.languages.registerHoverProvider("aice", {
        provideHover(document, position) {
          return sendRequest("textDocument/hover", {
            textDocument: { uri: document.uri.toString() },
            position: { line: position.line, character: position.character },
          }).then((res) => {
            if (!res || !res.contents) return null;
            const markdown =
              typeof res.contents === "string" ? res.contents : res.contents.value;
            return new vscode.Hover(new vscode.MarkdownString(markdown));
          });
        },
      })
    );

    // 5. Completion Item Provider
    context.subscriptions.push(
      vscode.languages.registerCompletionItemProvider(
        "aice",
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
        " ",
        "$"
      )
    );

    // 6. Document Formatting Provider
    context.subscriptions.push(
      vscode.languages.registerDocumentFormattingEditProvider("aice", {
        provideDocumentFormattingEdits(document, options) {
          return sendRequest("textDocument/formatting", {
            textDocument: { uri: document.uri.toString() },
            options: {
              tabSize: options.tabSize,
              insertSpaces: options.insertSpaces,
            },
          }).then((edits) => {
            if (!edits || !Array.isArray(edits)) return [];
            return edits.map((e) => {
              const range = new vscode.Range(
                new vscode.Position(e.range.start.line, e.range.start.character),
                new vscode.Position(e.range.end.line, e.range.end.character)
              );
              return new vscode.TextEdit(range, e.newText);
            });
          });
        },
      })
    );

    // 7. Document Symbol Provider
    context.subscriptions.push(
      vscode.languages.registerDocumentSymbolProvider("aice", {
        provideDocumentSymbols(document) {
          return sendRequest("textDocument/documentSymbol", {
            textDocument: { uri: document.uri.toString() },
          }).then((symbols) => {
            if (!symbols || !Array.isArray(symbols)) return [];
            return symbols.map(toVsCodeSymbol);
          });
        },
      })
    );

    // 8. Definition Provider
    context.subscriptions.push(
      vscode.languages.registerDefinitionProvider("aice", {
        provideDefinition(document, position) {
          return sendRequest("textDocument/definition", {
            textDocument: { uri: document.uri.toString() },
            position: { line: position.line, character: position.character },
          }).then((res) => {
            if (!res || !res.uri || !res.range) return null;
            const targetUri = vscode.Uri.parse(res.uri);
            const range = new vscode.Range(
              new vscode.Position(res.range.start.line, res.range.start.character),
              new vscode.Position(res.range.end.line, res.range.end.character)
            );
            return new vscode.Location(targetUri, range);
          });
        },
      })
    );

    // 9. Code Actions Provider
    context.subscriptions.push(
      vscode.languages.registerCodeActionsProvider("aice", {
        provideCodeActions(document, range, codeContext) {
          return sendRequest("textDocument/codeAction", {
            textDocument: { uri: document.uri.toString() },
            range: {
              start: { line: range.start.line, character: range.start.character },
              end: { line: range.end.line, character: range.end.character },
            },
            context: {
              diagnostics: (codeContext.diagnostics || []).map((d) => ({
                range: {
                  start: { line: d.range.start.line, character: d.range.start.character },
                  end: { line: d.range.end.line, character: d.range.end.character },
                },
                message: d.message,
                code: d.code,
                source: d.source,
              })),
            },
          }).then((actions) => {
            if (!actions || !Array.isArray(actions)) return [];
            return actions.map((a) => {
              const ca = new vscode.CodeAction(
                a.title,
                a.kind === "quickfix"
                  ? vscode.CodeActionKind.QuickFix
                  : vscode.CodeActionKind.Empty
              );
              ca.isPreferred = a.isPreferred;
              if (a.edit && a.edit.changes) {
                const we = new vscode.WorkspaceEdit();
                for (const [uriStr, edits] of Object.entries(a.edit.changes)) {
                  const fileUri = vscode.Uri.parse(uriStr);
                  const textEdits = edits.map((e) => {
                    const r = new vscode.Range(
                      new vscode.Position(e.range.start.line, e.range.start.character),
                      new vscode.Position(e.range.end.line, e.range.end.character)
                    );
                    return new vscode.TextEdit(r, e.newText);
                  });
                  we.set(fileUri, textEdits);
                }
                ca.edit = we;
              }
              return ca;
            });
          });
        },
      })
    );

    // Sync any already open AICE documents
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.languageId === "aice") {
        sendNotification("textDocument/didOpen", {
          textDocument: {
            uri: doc.uri.toString(),
            languageId: "aice",
            version: doc.version,
            text: doc.getText(),
          },
        });
      }
    }
  }

  // 10. Register Contributed AICE Commands
  registerAiceCommands(context);
}

function toVsCodeSymbol(s) {
  const range = new vscode.Range(
    new vscode.Position(s.range.start.line, s.range.start.character),
    new vscode.Position(s.range.end.line, s.range.end.character)
  );
  const selectionRange = new vscode.Range(
    new vscode.Position(s.selectionRange.start.line, s.selectionRange.start.character),
    new vscode.Position(s.selectionRange.end.line, s.selectionRange.end.character)
  );
  const kind =
    typeof s.kind === "number" && s.kind > 0
      ? s.kind - 1
      : vscode.SymbolKind.Variable;
  const vsSym = new vscode.DocumentSymbol(
    s.name,
    s.detail || "",
    kind,
    range,
    selectionRange
  );
  if (s.children && Array.isArray(s.children)) {
    vsSym.children = s.children.map(toVsCodeSymbol);
  }
  return vsSym;
}

function getAiceCommand() {
  const config = vscode.workspace.getConfiguration("aice");
  const configured = config.get("executablePath");
  if (configured && configured !== "aice") {
    return { bin: configured, args: [] };
  }
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders && workspaceFolders.length > 0) {
    const rootPath = workspaceFolders[0].uri.fsPath;
    const localMjs = path.join(rootPath, "bin", "aice.mjs");
    if (fs.existsSync(localMjs)) {
      return { bin: "node", args: [localMjs] };
    }
    const localTs = path.join(rootPath, "bin", "aice.ts");
    if (fs.existsSync(localTs)) {
      return { bin: "bun", args: [localTs] };
    }
  }
  return { bin: "aice", args: [] };
}

function getWorkspaceRoot() {
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    return folders[0].uri.fsPath;
  }
  const editor = vscode.window.activeTextEditor;
  if (editor && editor.document.uri.scheme === "file") {
    return path.dirname(editor.document.fileName);
  }
  return process.cwd();
}

function runCliInOutput(subcommandArgs, cwd) {
  outputChannel.show(true);
  const cmdInfo = getAiceCommand();
  const allArgs = [...cmdInfo.args, ...subcommandArgs];
  outputChannel.appendLine(`\n[AICE Toolchain] Running: ${cmdInfo.bin} ${allArgs.join(" ")}`);

  const child = spawn(cmdInfo.bin, allArgs, { cwd: cwd || getWorkspaceRoot() });
  child.stdout.on("data", (d) => outputChannel.append(d.toString()));
  child.stderr.on("data", (d) => outputChannel.append(d.toString()));
  child.on("close", (code) => {
    outputChannel.appendLine(`[AICE Toolchain] Process completed with code ${code}\n`);
  });
}

function runInTerminal(commandString, cwd) {
  if (!aiceTerminal || aiceTerminal.exitStatus !== undefined) {
    aiceTerminal = vscode.window.createTerminal({ name: "AICE", cwd: cwd || getWorkspaceRoot() });
  }
  aiceTerminal.show();
  aiceTerminal.sendText(commandString);
}

function registerAiceCommands(context) {
  const register = (id, handler) => {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  };

  register("aice.compile", () => {
    const editor = vscode.window.activeTextEditor;
    const file = editor ? editor.document.fileName : ".";
    runCliInOutput(["compile", file]);
  });

  register("aice.watch", () => {
    const cmdInfo = getAiceCommand();
    const cmdStr = `${cmdInfo.bin} ${[...cmdInfo.args, "watch", ".", "--bidirectional"].join(" ")}`;
    runInTerminal(cmdStr);
  });

  register("aice.sync", () => {
    runCliInOutput(["sync", "."]);
  });

  register("aice.outline", () => {
    const editor = vscode.window.activeTextEditor;
    const file = editor ? editor.document.fileName : ".";
    runCliInOutput(["outline", file]);
  });

  register("aice.context", () => {
    const editor = vscode.window.activeTextEditor;
    const file = editor ? editor.document.fileName : ".";
    runCliInOutput(["context", file]);
  });

  register("aice.idiomsScan", () => {
    runCliInOutput(["idioms", "scan", "."]);
  });

  register("aice.idiomsApply", () => {
    runCliInOutput(["idioms", "apply", "."]);
  });

  register("aice.shieldStatus", () => {
    runCliInOutput(["shield", "status"]);
  });

  register("aice.shieldLock", () => {
    runCliInOutput(["shield", "lock", "."]);
  });

  register("aice.shieldUnlock", () => {
    runCliInOutput(["shield", "unlock", "."]);
  });

  register("aice.test", () => {
    const cmdInfo = getAiceCommand();
    const cmdStr = `${cmdInfo.bin} ${[...cmdInfo.args, "test"].join(" ")}`;
    runInTerminal(cmdStr);
  });
}

function spawnLspServer(context) {
  const config = vscode.workspace.getConfiguration("aice");
  const configured = config.get("executablePath");
  if (configured && configured !== "aice") {
    return spawn(configured, ["lsp"]);
  }

  // Check workspace for local aice daemon
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders && workspaceFolders.length > 0) {
    const rootPath = workspaceFolders[0].uri.fsPath;
    const lspTs = path.join(rootPath, "bin", "aice-lsp.ts");
    if (fs.existsSync(lspTs)) {
      return spawn("bun", [lspTs], { cwd: rootPath });
    }
    const lspMjs = path.join(rootPath, "bin", "aice-lsp.mjs");
    if (fs.existsSync(lspMjs)) {
      return spawn("node", [lspMjs], { cwd: rootPath });
    }
  }

  // Fallback to globally available aice lsp
  return spawn("aice", ["lsp"]);
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
      console.error("[AICE LSP] JSON parse error:", e);
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
      const diag = new vscode.Diagnostic(
        range,
        d.message,
        vscode.DiagnosticSeverity.Error
      );
      diag.code = d.code;
      diag.source = d.source || "aice";
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
