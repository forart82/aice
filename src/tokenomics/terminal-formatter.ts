/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Responsive Terminal Formatting Engine for AIL 2.0 Tokenomics CLI.
 * Dynamically adapts output to terminal width, provides ANSI color themes,
 * visual progress bars, and flicker-free character-exact Unicode box borders.
 */

import type { TokenomicsAuditReport, TokenomicsFileResult } from "./index.js";

export interface TerminalFormatOptions {
  width?: number;
  useColor?: boolean;
  title?: string;
}

export interface ColumnDef {
  name: string;
  width: number;
  align: "left" | "right" | "center";
}

/**
 * Strips all ANSI escape sequences from a string to measure its visible terminal width.
 */
export function stripAnsi(str: string): string {
  return str.replace(
    // biome-ignore lint/suspicious/noControlCharactersInRegex: necessary for ANSI stripping
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    "",
  );
}

export function visibleLength(str: string): number {
  return stripAnsi(str).length;
}

export function padRight(str: string, width: number): string {
  const pad = Math.max(0, width - visibleLength(str));
  return str + " ".repeat(pad);
}

export function padLeft(str: string, width: number): string {
  const pad = Math.max(0, width - visibleLength(str));
  return " ".repeat(pad) + str;
}

export function padCenter(str: string, width: number): string {
  const totalPad = Math.max(0, width - visibleLength(str));
  const leftPad = Math.floor(totalPad / 2);
  const rightPad = totalPad - leftPad;
  return " ".repeat(leftPad) + str + " ".repeat(rightPad);
}

export function truncateMiddle(str: string, maxLength: number): string {
  if (visibleLength(str) <= maxLength) return str;
  if (maxLength <= 5) return str.slice(0, maxLength);
  const left = Math.ceil((maxLength - 3) / 2);
  const right = Math.floor((maxLength - 3) / 2);
  return `${str.slice(0, left)}...${str.slice(str.length - right)}`;
}

export function getTheme(useColor: boolean) {
  if (!useColor) {
    return {
      bold: (s: string) => s,
      dim: (s: string) => s,
      cyan: (s: string) => s,
      brightCyan: (s: string) => s,
      green: (s: string) => s,
      brightGreen: (s: string) => s,
      yellow: (s: string) => s,
      red: (s: string) => s,
      white: (s: string) => s,
      gray: (s: string) => s,
      magenta: (s: string) => s,
    };
  }
  return {
    bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
    dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
    cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
    brightCyan: (s: string) => `\x1b[1;36m${s}\x1b[0m`,
    green: (s: string) => `\x1b[32m${s}\x1b[0m`,
    brightGreen: (s: string) => `\x1b[1;32m${s}\x1b[0m`,
    yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
    red: (s: string) => `\x1b[31m${s}\x1b[0m`,
    white: (s: string) => `\x1b[37m${s}\x1b[0m`,
    gray: (s: string) => `\x1b[90m${s}\x1b[0m`,
    magenta: (s: string) => `\x1b[35m${s}\x1b[0m`,
  };
}

export function formatSavingsBadge(pct: number, theme: ReturnType<typeof getTheme>): string {
  const sign = pct >= 0 ? "-" : "+";
  const absVal = Math.abs(pct).toFixed(1);
  const text = `${sign}${absVal}%`;
  if (pct >= 25) {
    return theme.brightGreen(text);
  }
  if (pct > 0) {
    return theme.green(text);
  }
  if (pct === 0) {
    return theme.gray(text);
  }
  return theme.yellow(text);
}

export function formatProgressBar(
  ratio: number,
  barLength: number,
  theme: ReturnType<typeof getTheme>,
): string {
  const clamped = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(clamped * barLength);
  const empty = Math.max(0, barLength - filled);
  const filledStr = theme.green("█".repeat(filled));
  const emptyStr = theme.gray("░".repeat(empty));
  return `[${filledStr}${emptyStr}]`;
}

/**
 * Formats a single file tokenomics result into a high-density, beautifully framed card.
 * Automatically adapts to the terminal's column width.
 */
export function formatSingleFileSummary(
  f: TokenomicsFileResult,
  options: TerminalFormatOptions = {},
): string {
  const cols =
    options.width ??
    (typeof process !== "undefined" && process.stdout?.columns
      ? Math.min(process.stdout.columns, 96)
      : 78);
  const width = Math.max(64, Math.min(cols, 100));
  const innerWidth = width - 4; // 2 on left ("│ "), 2 on right (" │")

  const useColor =
    options.useColor ??
    Boolean(
      typeof process !== "undefined" &&
        process.stdout?.isTTY &&
        !process.env.NO_COLOR &&
        !process.env.NODE_DISABLE_COLORS,
    );
  const t = getTheme(useColor);

  const clSign = f.cl100kSavingsPct >= 0 ? "-" : "+";
  const o2Sign = f.o200kSavingsPct >= 0 ? "-" : "+";
  const chSign = f.charSavingsPct >= 0 ? "-" : "+";

  const clRatio = f.ailCl100k > 0 ? (f.targetCl100k / f.ailCl100k).toFixed(2) : "1.00";
  const o2Ratio = f.ailO200k > 0 ? (f.targetO200k / f.ailO200k).toFixed(2) : "1.00";
  const charRatio = f.ailChars > 0 ? (f.targetChars / f.ailChars).toFixed(2) : "1.00";

  let driftStatus = t.gray("Not verified (run with --check-drift)");
  if (f.driftChecked) {
    driftStatus = f.drift
      ? t.red(`❌ DRIFT DETECTED (${f.diffSummary ?? "output differs"})`)
      : t.brightGreen("✔ ZERO DRIFT (Lossless Bit-Identical)");
  } else if (f.drift) {
    driftStatus = t.red(`❌ DRIFT DETECTED (${f.diffSummary ?? "output differs"})`);
  }

  const barLen = Math.max(8, Math.min(14, Math.floor(width / 7)));
  const clSavingsRatio = Math.max(0, Math.min(1, f.cl100kSavingsPct / 100));
  const progressBar = formatProgressBar(clSavingsRatio, barLen, t);

  const topBorder = t.cyan(`┌${"─".repeat(width - 2)}┐`);
  const midBorder = t.cyan(`├${"─".repeat(width - 2)}┤`);
  const botBorder = t.cyan(`└${"─".repeat(width - 2)}┘`);

  function formatLine(content: string): string {
    const pad = Math.max(0, innerWidth - visibleLength(content));
    return `${t.cyan("│")} ${content}${" ".repeat(pad)} ${t.cyan("│")}`;
  }

  const lines: string[] = [
    topBorder,
    formatLine(`${t.brightCyan("◆")} ${t.bold(`AIL Token Efficiency Audit: ${f.file}`)}`),
    midBorder,
    formatLine(
      `${t.gray("Target Language:".padEnd(24))} ${t.white(f.targetLang)}${f.project ? t.gray(` (Project: ${f.project})`) : ""}`,
    ),
    formatLine(
      `${t.gray("Tokens (cl100k_base):".padEnd(24))} ${t.white(f.targetCl100k.toLocaleString())} ${t.dim("→")} ${t.white(f.ailCl100k.toLocaleString())}  ${formatSavingsBadge(f.cl100kSavingsPct, t)}  ${t.cyan(`(${clRatio}x density)`)}`,
    ),
    formatLine(
      `${t.gray("Tokens (o200k_base):".padEnd(24))} ${t.white(f.targetO200k.toLocaleString())} ${t.dim("→")} ${t.white(f.ailO200k.toLocaleString())}  ${formatSavingsBadge(f.o200kSavingsPct, t)}  ${t.cyan(`(${o2Ratio}x density)`)}`,
    ),
    formatLine(
      `${t.gray("Raw Characters:".padEnd(24))} ${t.white(f.targetChars.toLocaleString())} ${t.dim("→")} ${t.white(f.ailChars.toLocaleString())}  ${formatSavingsBadge(f.charSavingsPct, t)}  ${t.cyan(`(${charRatio}x density)`)}`,
    ),
    formatLine(
      `${t.gray("Savings Progress:".padEnd(24))} ${progressBar} ${formatSavingsBadge(f.cl100kSavingsPct, t)} tokens reduced`,
    ),
    formatLine(`${t.gray("Drift Status:".padEnd(24))} ${driftStatus}`),
    botBorder,
  ];

  return lines.join("\n");
}

/**
 * Renders a character-perfect, responsive Unicode table for multiple files in terminal.
 */
export function formatTokenomicsTerminalTable(
  report: TokenomicsAuditReport,
  options: TerminalFormatOptions = {},
): string {
  const terminalWidth =
    options.width ??
    (typeof process !== "undefined" && process.stdout?.columns
      ? Math.min(process.stdout.columns, 130)
      : 80);
  const width = Math.max(68, terminalWidth);
  const useColor =
    options.useColor ??
    Boolean(
      typeof process !== "undefined" &&
        process.stdout?.isTTY &&
        !process.env.NO_COLOR &&
        !process.env.NODE_DISABLE_COLORS,
    );
  const t = getTheme(useColor);

  const isWide = width >= 108;
  const isCompact = width < 82;

  let columns: ColumnDef[];
  if (isWide) {
    const fixedWidth = 10 + 12 + 11 + 10 + 9 + 10; // 62
    const totalDividers = 6 * 3; // 18
    const outerMargin = 4;
    const fileWidth = Math.max(16, width - fixedWidth - totalDividers - outerMargin);
    columns = [
      { name: "File", width: fileWidth, align: "left" },
      { name: "Language", width: 10, align: "left" },
      { name: "Target Tok", width: 12, align: "right" },
      { name: "AIL Tok", width: 11, align: "right" },
      { name: "Savings", width: 10, align: "right" },
      { name: "Density", width: 9, align: "right" },
      { name: "Char Sav", width: 10, align: "right" },
    ];
  } else if (!isCompact) {
    const fixedWidth = 10 + 11 + 10 + 10 + 9; // 50
    const totalDividers = 5 * 3; // 15
    const outerMargin = 4;
    const fileWidth = Math.max(16, width - fixedWidth - totalDividers - outerMargin);
    columns = [
      { name: "File", width: fileWidth, align: "left" },
      { name: "Language", width: 10, align: "left" },
      { name: "Target Tok", width: 11, align: "right" },
      { name: "AIL Tok", width: 10, align: "right" },
      { name: "Savings", width: 10, align: "right" },
      { name: "Density", width: 9, align: "right" },
    ];
  } else {
    // Compact mode (< 82 cols)
    const fixedWidth = 9 + 8 + 9 + 8; // 34
    const totalDividers = 4 * 3; // 12
    const outerMargin = 4;
    const fileWidth = Math.max(14, width - fixedWidth - totalDividers - outerMargin);
    columns = [
      { name: "File", width: fileWidth, align: "left" },
      { name: "Target", width: 9, align: "right" },
      { name: "AIL", width: 8, align: "right" },
      { name: "Savings", width: 9, align: "right" },
      { name: "Density", width: 8, align: "right" },
    ];
  }

  const tableInnerWidth = columns.reduce((sum, c) => sum + c.width, 0) + (columns.length - 1) * 3;
  const tableTotalWidth = tableInnerWidth + 4;

  const topBorder = t.cyan(`┌─${columns.map((c) => "─".repeat(c.width)).join("─┬─")}─┐`);
  const midBorder = t.cyan(`├─${columns.map((c) => "─".repeat(c.width)).join("─┼─")}─┤`);
  const botBorder = t.cyan(`└─${columns.map((c) => "─".repeat(c.width)).join("─┴─")}─┘`);

  function renderCells(cells: { text: string; color?: (s: string) => string }[]): string {
    const formatted = cells.map((cell, i) => {
      const col = columns[i];
      const truncated = truncateMiddle(cell.text, col.width);
      const aligned =
        col.align === "right"
          ? padLeft(truncated, col.width)
          : col.align === "center"
            ? padCenter(truncated, col.width)
            : padRight(truncated, col.width);
      return cell.color ? cell.color(aligned) : aligned;
    });
    return `${t.cyan("│")} ${formatted.join(` ${t.cyan("│")} `)} ${t.cyan("│")}`;
  }

  const lines: string[] = [];

  // Title line
  const rawTitle = options.title
    ? ` AIL 2.0 Token Efficiency Audit — ${truncateMiddle(options.title, tableTotalWidth - 10)} `
    : " AIL 2.0 Token Efficiency Audit ";
  const fillTitle = Math.max(2, tableTotalWidth - 2 - visibleLength(rawTitle));
  lines.push(
    t.cyan("┌─") + t.brightCyan(t.bold(rawTitle)) + t.cyan("─".repeat(fillTitle - 1)) + t.cyan("┐"),
  );

  // Header separator
  lines.push(t.cyan(`├─${columns.map((c) => "─".repeat(c.width)).join("─┬─")}─┤`));

  // Table column headers
  lines.push(renderCells(columns.map((c) => ({ text: c.name, color: t.bold }))));
  lines.push(midBorder);

  // File rows
  for (const f of report.files) {
    const density = f.ailCl100k > 0 ? `${(f.targetCl100k / f.ailCl100k).toFixed(2)}x` : "1.00x";
    const clSign = f.cl100kSavingsPct >= 0 ? "-" : "+";
    const clSavingsStr = `${clSign}${Math.abs(f.cl100kSavingsPct).toFixed(1)}%`;
    const chSign = f.charSavingsPct >= 0 ? "-" : "+";
    const chSavingsStr = `${chSign}${Math.abs(f.charSavingsPct).toFixed(1)}%`;

    const savingsColor =
      f.cl100kSavingsPct >= 25 ? t.brightGreen : f.cl100kSavingsPct > 0 ? t.green : t.yellow;

    if (isWide) {
      lines.push(
        renderCells([
          { text: f.file, color: t.white },
          { text: f.targetLang, color: t.gray },
          { text: f.targetCl100k.toLocaleString(), color: t.white },
          { text: f.ailCl100k.toLocaleString(), color: t.white },
          { text: clSavingsStr, color: savingsColor },
          { text: density, color: t.cyan },
          { text: chSavingsStr, color: t.gray },
        ]),
      );
    } else if (!isCompact) {
      lines.push(
        renderCells([
          { text: f.file, color: t.white },
          { text: f.targetLang, color: t.gray },
          { text: f.targetCl100k.toLocaleString(), color: t.white },
          { text: f.ailCl100k.toLocaleString(), color: t.white },
          { text: clSavingsStr, color: savingsColor },
          { text: density, color: t.cyan },
        ]),
      );
    } else {
      lines.push(
        renderCells([
          { text: f.file, color: t.white },
          { text: f.targetCl100k.toLocaleString(), color: t.white },
          { text: f.ailCl100k.toLocaleString(), color: t.white },
          { text: clSavingsStr, color: savingsColor },
          { text: density, color: t.cyan },
        ]),
      );
    }
  }

  // Summary row
  lines.push(midBorder);

  const agg = report.aggregate;
  const totalDensity =
    agg.ailCl100k > 0 ? `${(agg.targetCl100k / agg.ailCl100k).toFixed(2)}x` : "1.00x";
  const totClSign = agg.cl100kSavingsPct >= 0 ? "-" : "+";
  const totClSavingsStr = `${totClSign}${Math.abs(agg.cl100kSavingsPct).toFixed(1)}%`;
  const totChSign = agg.charSavingsPct >= 0 ? "-" : "+";
  const totChSavingsStr = `${totChSign}${Math.abs(agg.charSavingsPct).toFixed(1)}%`;
  const totSavingsColor =
    agg.cl100kSavingsPct >= 25 ? t.brightGreen : agg.cl100kSavingsPct > 0 ? t.green : t.yellow;

  const fullTotalLabel = `TOTAL (${report.files.length} ${report.files.length === 1 ? "File" : "Files"})`;
  const totalLabel =
    columns[0].width >= fullTotalLabel.length ? fullTotalLabel : `TOTAL (${report.files.length})`;

  if (isWide) {
    lines.push(
      renderCells([
        { text: totalLabel, color: t.bold },
        { text: "Aggregated", color: t.dim },
        { text: agg.targetCl100k.toLocaleString(), color: t.bold },
        { text: agg.ailCl100k.toLocaleString(), color: t.bold },
        { text: totClSavingsStr, color: totSavingsColor },
        { text: totalDensity, color: t.brightCyan },
        { text: totChSavingsStr, color: t.gray },
      ]),
    );
  } else if (!isCompact) {
    lines.push(
      renderCells([
        { text: totalLabel, color: t.bold },
        { text: "Aggregated", color: t.dim },
        { text: agg.targetCl100k.toLocaleString(), color: t.bold },
        { text: agg.ailCl100k.toLocaleString(), color: t.bold },
        { text: totClSavingsStr, color: totSavingsColor },
        { text: totalDensity, color: t.brightCyan },
      ]),
    );
  } else {
    lines.push(
      renderCells([
        { text: totalLabel, color: t.bold },
        { text: agg.targetCl100k.toLocaleString(), color: t.bold },
        { text: agg.ailCl100k.toLocaleString(), color: t.bold },
        { text: totClSavingsStr, color: totSavingsColor },
        { text: totalDensity, color: t.brightCyan },
      ]),
    );
  }

  lines.push(botBorder);

  return lines.join("\n");
}

/**
 * Renders a character-perfect, responsive Unicode table for project summaries in terminal.
 */
export function formatProjectsTerminalTable(
  report: TokenomicsAuditReport,
  options: TerminalFormatOptions = {},
): string {
  const terminalWidth =
    options.width ??
    (typeof process !== "undefined" && process.stdout?.columns
      ? Math.min(process.stdout.columns, 130)
      : 80);
  const width = Math.max(68, terminalWidth);
  const useColor =
    options.useColor ??
    Boolean(
      typeof process !== "undefined" &&
        process.stdout?.isTTY &&
        !process.env.NO_COLOR &&
        !process.env.NODE_DISABLE_COLORS,
    );
  const t = getTheme(useColor);

  interface ProjSummary {
    project: string;
    targetLang: string;
    fileCount: number;
    targetChars: number;
    ailChars: number;
    targetCl100k: number;
    ailCl100k: number;
    cl100kSavingsPct: number;
  }

  const projectMap = new Map<string, ProjSummary>();
  for (const f of report.files) {
    const proj = f.project || "default";
    let entry = projectMap.get(proj);
    if (!entry) {
      entry = {
        project: proj,
        targetLang: f.targetLang,
        fileCount: 0,
        targetChars: 0,
        ailChars: 0,
        targetCl100k: 0,
        ailCl100k: 0,
        cl100kSavingsPct: 0,
      };
      projectMap.set(proj, entry);
    }
    entry.fileCount++;
    entry.targetChars += f.targetChars;
    entry.ailChars += f.ailChars;
    entry.targetCl100k += f.targetCl100k;
    entry.ailCl100k += f.ailCl100k;
    if (entry.targetLang !== f.targetLang) {
      entry.targetLang = "Polyglot";
    }
  }

  const projects = Array.from(projectMap.values()).sort((a, b) =>
    a.project.localeCompare(b.project),
  );
  for (const p of projects) {
    p.cl100kSavingsPct =
      p.targetCl100k > 0 ? ((p.targetCl100k - p.ailCl100k) / p.targetCl100k) * 100 : 0;
  }

  const fixedWidth = 10 + 6 + 11 + 10 + 9 + 8; // 54
  const totalDividers = 6 * 3; // 18
  const outerMargin = 4;
  const projWidth = Math.max(16, width - fixedWidth - totalDividers - outerMargin);

  const columns: ColumnDef[] = [
    { name: "Project", width: projWidth, align: "left" },
    { name: "Language", width: 10, align: "left" },
    { name: "Files", width: 6, align: "right" },
    { name: "Target Tok", width: 11, align: "right" },
    { name: "AIL Tok", width: 10, align: "right" },
    { name: "Savings", width: 9, align: "right" },
    { name: "Density", width: 8, align: "right" },
  ];

  const tableInnerWidth = columns.reduce((sum, c) => sum + c.width, 0) + (columns.length - 1) * 3;
  const tableTotalWidth = tableInnerWidth + 4;

  const topBorder = t.cyan(`┌─${columns.map((c) => "─".repeat(c.width)).join("─┬─")}─┐`);
  const midBorder = t.cyan(`├─${columns.map((c) => "─".repeat(c.width)).join("─┼─")}─┤`);
  const botBorder = t.cyan(`└─${columns.map((c) => "─".repeat(c.width)).join("─┴─")}─┘`);

  function renderCells(cells: { text: string; color?: (s: string) => string }[]): string {
    const formatted = cells.map((cell, i) => {
      const col = columns[i];
      const truncated = truncateMiddle(cell.text, col.width);
      const aligned =
        col.align === "right"
          ? padLeft(truncated, col.width)
          : col.align === "center"
            ? padCenter(truncated, col.width)
            : padRight(truncated, col.width);
      return cell.color ? cell.color(aligned) : aligned;
    });
    return `${t.cyan("│")} ${formatted.join(` ${t.cyan("│")} `)} ${t.cyan("│")}`;
  }

  const lines: string[] = [];

  const rawTitle = options.title
    ? ` AIL 2.0 Project Tokenomics Summary — ${truncateMiddle(options.title, tableTotalWidth - 10)} `
    : " AIL 2.0 Project Tokenomics Summary ";
  const fillTitle = Math.max(2, tableTotalWidth - 2 - visibleLength(rawTitle));
  lines.push(
    t.cyan("┌─") + t.brightCyan(t.bold(rawTitle)) + t.cyan("─".repeat(fillTitle - 1)) + t.cyan("┐"),
  );
  lines.push(t.cyan(`├─${columns.map((c) => "─".repeat(c.width)).join("─┬─")}─┤`));
  lines.push(renderCells(columns.map((c) => ({ text: c.name, color: t.bold }))));
  lines.push(midBorder);

  for (const p of projects) {
    const density = p.ailCl100k > 0 ? `${(p.targetCl100k / p.ailCl100k).toFixed(2)}x` : "1.00x";
    const clSign = p.cl100kSavingsPct >= 0 ? "-" : "+";
    const clSavingsStr = `${clSign}${Math.abs(p.cl100kSavingsPct).toFixed(1)}%`;
    const savingsColor =
      p.cl100kSavingsPct >= 25 ? t.brightGreen : p.cl100kSavingsPct > 0 ? t.green : t.yellow;

    lines.push(
      renderCells([
        { text: p.project, color: t.white },
        { text: p.targetLang, color: t.gray },
        { text: p.fileCount.toString(), color: t.white },
        { text: p.targetCl100k.toLocaleString(), color: t.white },
        { text: p.ailCl100k.toLocaleString(), color: t.white },
        { text: clSavingsStr, color: savingsColor },
        { text: density, color: t.cyan },
      ]),
    );
  }

  lines.push(midBorder);

  const agg = report.aggregate;
  const totalDensity =
    agg.ailCl100k > 0 ? `${(agg.targetCl100k / agg.ailCl100k).toFixed(2)}x` : "1.00x";
  const totClSign = agg.cl100kSavingsPct >= 0 ? "-" : "+";
  const totClSavingsStr = `${totClSign}${Math.abs(agg.cl100kSavingsPct).toFixed(1)}%`;
  const totSavingsColor =
    agg.cl100kSavingsPct >= 25 ? t.brightGreen : agg.cl100kSavingsPct > 0 ? t.green : t.yellow;

  const fullTotalProj = `TOTAL (${projects.length} ${projects.length === 1 ? "Project" : "Projects"})`;
  const totalProjText =
    projWidth >= fullTotalProj.length ? fullTotalProj : `TOTAL (${projects.length})`;

  lines.push(
    renderCells([
      {
        text: totalProjText,
        color: t.bold,
      },
      { text: "Polyglot", color: t.dim },
      { text: report.files.length.toString(), color: t.bold },
      { text: agg.targetCl100k.toLocaleString(), color: t.bold },
      { text: agg.ailCl100k.toLocaleString(), color: t.bold },
      { text: totClSavingsStr, color: totSavingsColor },
      { text: totalDensity, color: t.brightCyan },
    ]),
  );

  lines.push(botBorder);

  return lines.join("\n");
}
