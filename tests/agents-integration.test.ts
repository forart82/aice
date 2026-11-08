import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import {
  AICE_DIRECTIVE_END,
  AICE_DIRECTIVE_START,
  formatAgentsStatusTable,
  getAgentsStatus,
  removeAgents,
  setupAgents,
} from "../src/agents/index.js";
import { AiceMcpServer, type McpToolCallResult } from "../src/mcp/server.js";

describe("Phase 4: Global MCP Server Upgrade & Major CLI Agent Auto-Integration", () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "aice-agents-home-"));
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("idempotently sets up, reports status, and cleanly removes AICE across all 7 CLI agents while preserving existing user configs", () => {
    // Seed existing user configurations across all 7 agents
    fs.mkdirSync(path.join(tmpHome, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpHome, ".claude.json"),
      JSON.stringify(
        {
          theme: "dark",
          mcpServers: {
            github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] },
          },
        },
        null,
        2,
      ),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(tmpHome, ".claude", "settings.json"),
      JSON.stringify({ permissions: ["read"] }, null, 2),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(tmpHome, ".claude", "CLAUDE.md"),
      "# User Claude Rules\nAlways write tests.\n",
      "utf-8",
    );

    fs.mkdirSync(path.join(tmpHome, ".gemini"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpHome, ".gemini", "settings.json"),
      JSON.stringify({ model: "gemini-2.5-pro", mcpServers: { existing: { command: "foo" } } }),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(tmpHome, ".gemini", "GEMINI.md"),
      "# User Gemini Notes\nKeep commits atomic.\n",
      "utf-8",
    );

    fs.mkdirSync(path.join(tmpHome, ".codex"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpHome, ".codex", "config.toml"),
      [
        'model = "o3"',
        "",
        "[mcp_servers.other]",
        'command = "other-mcp"',
        'args = ["--stdio"]',
        "",
      ].join("\n"),
      "utf-8",
    );
    fs.writeFileSync(path.join(tmpHome, ".codex", "instructions.md"), "# Custom Codex\n", "utf-8");

    fs.mkdirSync(path.join(tmpHome, ".config", "opencode"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpHome, ".config", "opencode", "opencode.json"),
      JSON.stringify({ provider: "anthropic" }, null, 2),
      "utf-8",
    );

    fs.writeFileSync(
      path.join(tmpHome, ".aider.conf.yml"),
      YAML.stringify({ model: "sonnet", read: ["README.md"] }),
      "utf-8",
    );

    fs.mkdirSync(path.join(tmpHome, ".config", "goose"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpHome, ".config", "goose", "config.yaml"),
      YAML.stringify({ GOOSE_PROVIDER: "openai", extensions: { memory: { enabled: true } } }),
      "utf-8",
    );

    fs.mkdirSync(path.join(tmpHome, ".cursor"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpHome, ".cursor", "mcp.json"),
      JSON.stringify({ mcpServers: { browser: { command: "browser-mcp" } } }, null, 2),
      "utf-8",
    );

    // Run setupAgents (--all) twice to verify idempotency
    const firstSetup = setupAgents({ homeDir: tmpHome, all: true });
    const secondSetup = setupAgents({ homeDir: tmpHome, all: true });

    expect(secondSetup.agents).toHaveLength(7);
    for (const agent of secondSetup.agents) {
      expect(agent.mcpConfigured).toBe(true);
      if (agent.promptPath) {
        expect(agent.promptConfigured).toBe(true);
      }
    }

    const tableText = formatAgentsStatusTable(firstSetup);
    expect(tableText).toContain("Claude Code (claude)");
    expect(tableText).toContain("Antigravity / Gemini CLI");
    expect(tableText).toContain("OpenAI Codex CLI");

    // 1. Verify Claude Code
    const claudeJson = JSON.parse(fs.readFileSync(path.join(tmpHome, ".claude.json"), "utf-8"));
    expect(claudeJson.theme).toBe("dark");
    expect(claudeJson.mcpServers.github).toBeDefined();
    expect(claudeJson.mcpServers.aice).toEqual({ command: "aice", args: ["mcp"] });

    const claudeSettings = JSON.parse(
      fs.readFileSync(path.join(tmpHome, ".claude", "settings.json"), "utf-8"),
    );
    expect(claudeSettings.permissions).toEqual(["read"]);
    expect(claudeSettings.mcpServers.aice).toEqual({ command: "aice", args: ["mcp"] });

    const claudeMd = fs.readFileSync(path.join(tmpHome, ".claude", "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain("# User Claude Rules");
    expect(claudeMd.split(AICE_DIRECTIVE_START).length - 1).toBe(1);
    expect(claudeMd).toContain(AICE_DIRECTIVE_END);

    // 2. Verify Antigravity / Gemini CLI
    const geminiSettings = JSON.parse(
      fs.readFileSync(path.join(tmpHome, ".gemini", "settings.json"), "utf-8"),
    );
    expect(geminiSettings.model).toBe("gemini-2.5-pro");
    expect(geminiSettings.mcpServers.existing).toEqual({ command: "foo" });
    expect(geminiSettings.mcpServers.aice).toEqual({ command: "aice", args: ["mcp"] });

    const geminiMd = fs.readFileSync(path.join(tmpHome, ".gemini", "GEMINI.md"), "utf-8");
    expect(geminiMd).toContain("# User Gemini Notes");
    expect(geminiMd.split(AICE_DIRECTIVE_START).length - 1).toBe(1);

    // 3. Verify OpenAI Codex CLI
    const codexToml = fs.readFileSync(path.join(tmpHome, ".codex", "config.toml"), "utf-8");
    expect(codexToml).toContain('model = "o3"');
    expect(codexToml).toContain("[mcp_servers.other]");
    expect(codexToml.split("[mcp_servers.aice]").length - 1).toBe(1);
    expect(fs.readFileSync(path.join(tmpHome, ".codex", "instructions.md"), "utf-8")).toContain(
      AICE_DIRECTIVE_START,
    );

    // 4. Verify OpenCode
    const opencodeJson = JSON.parse(
      fs.readFileSync(path.join(tmpHome, ".config", "opencode", "opencode.json"), "utf-8"),
    );
    expect(opencodeJson.provider).toBe("anthropic");
    expect(opencodeJson.mcpServers.aice).toEqual({ command: "aice", args: ["mcp"] });
    expect(opencodeJson.mcp.aice).toBeDefined();

    // 5. Verify Aider
    const aiderConf = YAML.parse(fs.readFileSync(path.join(tmpHome, ".aider.conf.yml"), "utf-8"));
    expect(aiderConf.model).toBe("sonnet");
    expect(aiderConf.read).toContain("README.md");
    expect(aiderConf.read).toContain(path.join(tmpHome, ".aider", "CONVENTIONS.md"));

    // 6. Verify Goose & 7. Cursor
    const gooseConf = YAML.parse(
      fs.readFileSync(path.join(tmpHome, ".config", "goose", "config.yaml"), "utf-8"),
    );
    expect(gooseConf.GOOSE_PROVIDER).toBe("openai");
    expect(gooseConf.extensions.memory.enabled).toBe(true);
    expect(gooseConf.extensions.aice.cmd).toBe("aice");

    const cursorConf = JSON.parse(
      fs.readFileSync(path.join(tmpHome, ".cursor", "mcp.json"), "utf-8"),
    );
    expect(cursorConf.mcpServers.browser).toEqual({ command: "browser-mcp" });
    expect(cursorConf.mcpServers.aice).toEqual({ command: "aice", args: ["mcp"] });

    // Remove all agents and verify user settings remain intact while AICE entries are gone
    const removedStatus = removeAgents({ homeDir: tmpHome });
    for (const agent of removedStatus.agents) {
      expect(agent.mcpConfigured).toBe(false);
      expect(agent.promptConfigured).toBe(false);
    }

    const claudeJsonAfter = JSON.parse(
      fs.readFileSync(path.join(tmpHome, ".claude.json"), "utf-8"),
    );
    expect(claudeJsonAfter.theme).toBe("dark");
    expect(claudeJsonAfter.mcpServers.github).toBeDefined();
    expect(claudeJsonAfter.mcpServers.aice).toBeUndefined();

    const claudeMdAfter = fs.readFileSync(path.join(tmpHome, ".claude", "CLAUDE.md"), "utf-8");
    expect(claudeMdAfter).toContain("# User Claude Rules");
    expect(claudeMdAfter).not.toContain(AICE_DIRECTIVE_START);

    const codexTomlAfter = fs.readFileSync(path.join(tmpHome, ".codex", "config.toml"), "utf-8");
    expect(codexTomlAfter).toContain('model = "o3"');
    expect(codexTomlAfter).toContain("[mcp_servers.other]");
    expect(codexTomlAfter).not.toContain("[mcp_servers.aice]");

    const statusCheck = getAgentsStatus({ homeDir: tmpHome, agent: "gemini" });
    expect(statusCheck.agents).toHaveLength(1);
    expect(statusCheck.agents[0]?.id).toBe("agy");
  });

  it("allows multi-project paths under $HOME, os.tmpdir(), and declared MCP workspaceFolders while blocking sensitive system paths and traversal", async () => {
    const initialWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "aice-mcp-ws1-"));
    const secondWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "aice-mcp-ws2-"));

    try {
      const externalFile = path.join(secondWorkspace, "service.ts");
      fs.writeFileSync(
        externalFile,
        "export function computeTotal(price: number, tax: number): number {\n  return price + tax;\n}\n",
        "utf-8",
      );

      const server = new AiceMcpServer(undefined, undefined, { workspaceRoot: initialWorkspace });

      // Initialize with workspaceFolders pointing to secondWorkspace
      const initRes = (await server.handleRequest(1, "initialize", {
        workspaceFolders: [{ uri: `file://${secondWorkspace}`, name: "ws2" }],
      })) as { serverInfo?: { version?: string } };
      expect(initRes.serverInfo?.version).toBe("0.9.0");

      // Outline file in secondWorkspace (outside initialWorkspace) succeeds
      const outRes = (await server.handleRequest(2, "tools/call", {
        name: "aice_outline",
        arguments: { path: externalFile },
      })) as McpToolCallResult;
      expect(outRes.content[0].text).toContain("computeTotal");

      // Relative traversal `../../../etc/passwd` is rejected
      await expect(
        server.handleRequest(3, "tools/call", {
          name: "aice_outline",
          arguments: { path: "../../../etc/passwd" },
        }),
      ).rejects.toThrow("escapes workspace root");

      // Absolute sensitive system path `/etc/passwd` is rejected
      await expect(
        server.handleRequest(4, "tools/call", {
          name: "aice_outline",
          arguments: { path: "/etc/passwd" },
        }),
      ).rejects.toThrow("Access denied");

      // Symlink inside workspace pointing to `/etc/passwd` is rejected via realpath check
      const symlinkEscape = path.join(initialWorkspace, "passwd_link.ts");
      fs.symlinkSync("/etc/passwd", symlinkEscape);
      await expect(
        server.handleRequest(5, "tools/call", {
          name: "aice_outline",
          arguments: { path: symlinkEscape },
        }),
      ).rejects.toThrow("Access denied");
    } finally {
      fs.rmSync(initialWorkspace, { recursive: true, force: true });
      fs.rmSync(secondWorkspace, { recursive: true, force: true });
    }
  });
});
