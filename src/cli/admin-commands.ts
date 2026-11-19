/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from "node:path";
import * as readline from "node:readline";
import type { Command } from "commander";
import {
  findProjectRoot,
  isProjectAiceEnabled,
  isProjectIdiomsEnabled,
  loadProjectConfig,
  setProjectAiceEnabled,
  setProjectIdiomsEnabled,
} from "../config/index.js";
import { recordCliFailureTelemetry } from "./telemetry-and-flags.js";

async function promptLine(question: string): Promise<string> {
  if (!process.stdin.isTTY) return "";
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export function registerAdminCommands(program: Command): void {
  // Command: enable [dir]
  program
    .command("enable [dir]")
    .description('Enable AICE for a project in aice.config.json ("enabled": true)')
    .option("-f, --force", "Force AGENTS.md rule injection even if exceeding 22,000-byte cap")
    .option("--json", "Output updated project configuration as JSON")
    .action((dirArg: string | undefined, options: { force?: boolean; json?: boolean }) => {
      try {
        const targetDir = path.resolve(process.cwd(), dirArg ?? ".");
        const projectRoot = findProjectRoot(targetDir);
        const updated = setProjectAiceEnabled(projectRoot, true, { force: options.force });
        if (options.json) {
          console.log(
            JSON.stringify(
              {
                projectRoot,
                enabled: isProjectAiceEnabled(updated),
                idiomsEnabled: isProjectIdiomsEnabled(updated),
                idiomsCount: Object.keys(updated.idioms ?? {}).length,
              },
              null,
              2,
            ),
          );
          return;
        }
        console.log(
          `✔ AICE ENABLED ("enabled": true) in ${path.join(path.relative(process.cwd(), projectRoot) || ".", "aice.config.json")}`,
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        recordCliFailureTelemetry(msg, "context", dirArg);
        console.error(`❌ Error enabling AICE: ${msg}`);
        process.exit(1);
      }
    });

  // Command: disable [dir]
  program
    .command("disable [dir]")
    .description('Disable AICE for a project in aice.config.json ("enabled": false)')
    .option("--json", "Output updated project configuration as JSON")
    .action((dirArg: string | undefined, options: { json?: boolean }) => {
      try {
        const targetDir = path.resolve(process.cwd(), dirArg ?? ".");
        const projectRoot = findProjectRoot(targetDir);
        const updated = setProjectAiceEnabled(projectRoot, false);
        if (options.json) {
          console.log(
            JSON.stringify(
              {
                projectRoot,
                enabled: isProjectAiceEnabled(updated),
                idiomsEnabled: isProjectIdiomsEnabled(updated),
                idiomsCount: Object.keys(updated.idioms ?? {}).length,
              },
              null,
              2,
            ),
          );
          return;
        }
        console.log(
          `✔ AICE DISABLED ("enabled": false) in ${path.join(path.relative(process.cwd(), projectRoot) || ".", "aice.config.json")}`,
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        recordCliFailureTelemetry(msg, "context", dirArg);
        console.error(`❌ Error disabling AICE: ${msg}`);
        process.exit(1);
      }
    });

  // Command: config [dir] (alias: status)
  program
    .command("config [dir]")
    .alias("status")
    .description(
      "Inspect or toggle project-level AICE and $idioms configuration in aice.config.json",
    )
    .option("--enable", 'Set "enabled": true in aice.config.json')
    .option("--disable", 'Set "enabled": false in aice.config.json')
    .option("-f, --force", "Force AGENTS.md rule injection even if exceeding 22,000-byte cap")
    .option("--idioms-on", 'Set "idiomsEnabled": true in aice.config.json')
    .option("--idioms-off", 'Set "idiomsEnabled": false in aice.config.json')
    .option("--json", "Output project configuration status in JSON format")
    .action(
      (
        dirArg: string | undefined,
        options: {
          enable?: boolean;
          disable?: boolean;
          force?: boolean;
          idiomsOn?: boolean;
          idiomsOff?: boolean;
          json?: boolean;
        },
      ) => {
        try {
          const targetDir = path.resolve(process.cwd(), dirArg ?? ".");
          const projectRoot = findProjectRoot(targetDir);
          let config = loadProjectConfig(projectRoot);

          if (options.enable) {
            config = setProjectAiceEnabled(projectRoot, true, { force: options.force });
          } else if (options.disable) {
            config = setProjectAiceEnabled(projectRoot, false);
          }

          if (options.idiomsOn) {
            config = setProjectIdiomsEnabled(projectRoot, true);
          } else if (options.idiomsOff) {
            config = setProjectIdiomsEnabled(projectRoot, false);
          }

          const enabled = isProjectAiceEnabled(config);
          const idiomsEnabled = isProjectIdiomsEnabled(config);
          const idiomsCount = Object.keys(config.idioms ?? {}).length;

          if (options.json) {
            console.log(
              JSON.stringify(
                {
                  projectRoot,
                  enabled,
                  idiomsEnabled,
                  idiomsCount,
                },
                null,
                2,
              ),
            );
            return;
          }

          console.log(`\n=== AICE Project Config: ${projectRoot} ===`);
          console.log(`  AICE Status:    ${enabled ? "ENABLED" : "DISABLED (opt-out)"}`);
          console.log(`  Idioms Status:  ${idiomsEnabled ? "ENABLED" : "DISABLED"}`);
          console.log(`  Active Idioms:  ${idiomsCount}`);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          recordCliFailureTelemetry(msg, "context", dirArg);
          console.error(`❌ Error reading project config: ${msg}`);
          process.exit(1);
        }
      },
    );
  // Command: agents [action]
  program
    .command("agents [action]")
    .description(
      "Auto-integrate or inspect global AICE MCP server & system prompt across Linux CLI coding agents (claude, agy/gemini, codex, opencode, aider, goose, cursor)",
    )
    .option("--all", "Configure all supported CLI agent paths even if binary is not yet installed")
    .option("-a, --agent <name>", "Target a specific CLI agent (e.g. claude, gemini, codex)")
    .option(
      "--global-rules",
      "Also inject global system prompt rules into ~/.gemini, ~/.claude, etc. (default: false, rules are scoped to projects with aice.config.json)",
    )
    .option("--json", "Output agent integration status in JSON format")
    .action(
      async (
        actionArg: string | undefined,
        options: { all?: boolean; agent?: string; json?: boolean; globalRules?: boolean },
      ) => {
        try {
          const { formatAgentsStatusTable, getAgentsStatus, removeAgents, setupAgents } =
            await import("../agents/index.js");
          const action = (actionArg ?? "status").toLowerCase();
          if (action === "setup" || action === "install") {
            const statuses = setupAgents({
              all: Boolean(options.all),
              agent: options.agent,
              globalRules: Boolean(options.globalRules),
            });
            if (options.json) {
              console.log(JSON.stringify(statuses, null, 2));
              return;
            }
            console.log(formatAgentsStatusTable(statuses));
            const configuredCount = statuses.agents.filter(
              (s) => s.mcpConfigured || s.promptConfigured,
            ).length;
            console.log(
              `\n✔ AICE global CLI agent integration complete (${configuredCount} agent(s) active).`,
            );
            return;
          }

          if (action === "status" || action === "list") {
            const statuses = getAgentsStatus({
              agent: options.agent,
            });
            if (options.json) {
              console.log(JSON.stringify(statuses, null, 2));
              return;
            }
            console.log(formatAgentsStatusTable(statuses));
            return;
          }

          if (action === "remove" || action === "uninstall") {
            const statuses = removeAgents({
              agent: options.agent,
            });
            if (options.json) {
              console.log(JSON.stringify(statuses, null, 2));
              return;
            }
            console.log(formatAgentsStatusTable(statuses));
            console.log(
              "\n✔ Stripped AICE MCP entries and system directive blocks cleanly without losing user settings.",
            );
            return;
          }

          console.error(
            `❌ Unknown agents action: '${action}'. Supported actions: setup | status | remove`,
          );
          process.exit(1);
        } catch (err: unknown) {
          console.error(
            `❌ Error in aice agents: ${err instanceof Error ? err.message : String(err)}`,
          );
          process.exit(1);
        }
      },
    );

  // Command: gain [project]
  program
    .command("gain [project]")
    .aliases(["gains", "stats", "telemetry"])
    .description(
      "100% honest BPE token-savings telemetry dashboard (global overview & per-project drill-down)",
    )
    .option("-p, --project <pathOrName>", "Filter or drill down to a specific project")
    .option("--unique", "Deduplicate repeated identical operations by contentHash")
    .option("--all", "Include all cumulative operations (default)")
    .option("-i, --interactive", "Interactively select a project to drill down in TTY")
    .option("--json", "Emit full structured JSON telemetry report")
    .option("--reset", "Clear telemetry history")
    .option("-y, --yes", "Auto-confirm telemetry history reset")
    .action(
      async (
        projectArg: string | undefined,
        options: {
          project?: string;
          unique?: boolean;
          all?: boolean;
          interactive?: boolean;
          json?: boolean;
          reset?: boolean;
          yes?: boolean;
        },
      ) => {
        try {
          const {
            buildGainReport,
            formatGlobalGainDashboard,
            formatProjectGainDetail,
            resetTelemetryHistory,
          } = await import("../telemetry/index.js");
          if (options.reset) {
            if (!options.yes && process.stdin.isTTY) {
              const ans = await promptLine("Clear all AICE telemetry history? [y/N]: ");
              if (!/^y(es)?$/i.test(ans)) {
                console.log("Aborted telemetry reset.");
                return;
              }
            }
            const cleared = resetTelemetryHistory();
            if (options.json) {
              console.log(
                JSON.stringify(
                  {
                    reset: true,
                    path: cleared.telemetryPath,
                    deletedCount: cleared.deletedCount,
                  },
                  null,
                  2,
                ),
              );
            } else {
              console.log(
                `✔ Reset AICE telemetry ledger (${cleared.telemetryPath}, removed ${cleared.deletedCount} record(s))`,
              );
            }
            return;
          }

          const unique = Boolean(options.unique && !options.all);
          const requestedProject = options.project ?? projectArg;
          const isInteractivePick =
            Boolean(options.interactive) ||
            requestedProject === "select" ||
            requestedProject === "pick";

          const effectiveProjectQuery = isInteractivePick ? undefined : requestedProject;

          const report = buildGainReport({
            unique,
            project: effectiveProjectQuery,
          });

          if (options.json) {
            console.log(
              JSON.stringify(
                effectiveProjectQuery && report.projectDetail
                  ? {
                      unique: report.unique,
                      telemetryPath: report.telemetryPath,
                      project: report.projectDetail,
                    }
                  : report,
                null,
                2,
              ),
            );
            return;
          }

          if (effectiveProjectQuery) {
            if (!report.projectDetail || report.projectDetail.summary.totalCalls === 0) {
              console.log(
                `No recorded AICE telemetry found for project '${effectiveProjectQuery}'.`,
              );
              return;
            }
            console.log(formatProjectGainDetail(report.projectDetail));
            return;
          }

          console.log(formatGlobalGainDashboard(report));

          if (isInteractivePick && process.stdin.isTTY && report.projects.length > 0) {
            const choice = await promptLine(
              `Select a project [1-${report.projects.length}] to drill down (or press Enter to exit): `,
            );
            if (choice) {
              const idx = Number.parseInt(choice, 10);
              const selected =
                !Number.isNaN(idx) && idx >= 1 && idx <= report.projects.length
                  ? report.projects[idx - 1]
                  : report.projects.find(
                      (p) =>
                        p.projectName.toLowerCase() === choice.toLowerCase() ||
                        p.projectRoot === choice,
                    );
              if (selected) {
                const detailReport = buildGainReport({
                  unique,
                  project: selected.projectRoot,
                });
                if (detailReport.projectDetail) {
                  console.log(formatProjectGainDetail(detailReport.projectDetail));
                }
              }
            }
          }
        } catch (err: unknown) {
          console.error(
            `❌ Error in aice gain: ${err instanceof Error ? err.message : String(err)}`,
          );
          process.exit(1);
        }
      },
    );

  // Command: analyze [project]
  program
    .command("analyze [project]")
    .description(
      "Post-session project analyzer (scans AICE telemetry, agent session transcripts, token usage & friction audit)",
    )
    .option("-p, --project <pathOrName>", "Target project directory or name (defaults to cwd)")
    .option("--transcripts-dir <dir>", "Optional custom agent transcripts directory")
    .option("--json", "Emit structured JSON analysis report")
    .action(
      async (
        projectArg: string | undefined,
        options: {
          project?: string;
          transcriptsDir?: string;
          json?: boolean;
        },
      ) => {
        try {
          const { analyzeProject, formatAnalyzeReport } = await import("../telemetry/index.js");
          const report = analyzeProject({
            project: options.project ?? projectArg,
            transcriptsDir: options.transcriptsDir,
          });
          if (options.json) {
            console.log(JSON.stringify(report, null, 2));
            return;
          }
          console.log(formatAnalyzeReport(report));
        } catch (err: unknown) {
          console.error(
            `❌ Error in aice analyze: ${err instanceof Error ? err.message : String(err)}`,
          );
          process.exit(1);
        }
      },
    );
}
