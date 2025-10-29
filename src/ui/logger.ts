import pc from "picocolors";

export type LoggerOptions = {
  quiet?: boolean;
  useColor?: boolean;
  isTTY?: boolean;
};

type Summary = {
  status: "Success" | "Partial" | "Failed";
  durationMs: number;
  warnings: number;
  errors: number;
  imported: number;
  total: number;
};

const symbols = {
  header: pc.cyan("▶"),
  start: pc.cyan("▶"),
  progress: pc.cyan("…"),
  success: pc.green("✔"),
  warn: pc.yellow("⚠"),
  fail: pc.red("✖"),
  info: pc.cyan("ℹ"),
};

function colorize(enabled: boolean) {
  if (enabled) return pc;
  const id = (s: string) => s;
  return {
    ...pc,
    isColorSupported: false,
    reset: id,
    bold: id,
    dim: id,
    italic: id,
    underline: id,
    inverse: id,
    hidden: id,
    strikethrough: id,
    black: id,
    red: id,
    green: id,
    yellow: id,
    blue: id,
    magenta: id,
    cyan: id,
    white: id,
    gray: id,
    bgBlack: id,
    bgRed: id,
    bgGreen: id,
    bgYellow: id,
    bgBlue: id,
    bgMagenta: id,
    bgCyan: id,
    bgWhite: id,
  } as typeof pc;
}

export function createLogger(opts: LoggerOptions = {}) {
  const useColor =
    opts.useColor ?? (process.env.NO_COLOR ? false : pc.isColorSupported);
  const c = colorize(useColor);
  const isTTY = opts.isTTY ?? process.stdout.isTTY ?? false;
  const quiet = !!opts.quiet;

  function emit(line: string) {
    if (quiet) return;
    process.stdout.write(line + "\n");
  }

  function line(prefix: string, msg: string) {
    emit(`${prefix} ${msg}`);
  }

  return {
    logHeader(msg: string) {
      line(c.cyan(symbols.header), c.bold(msg));
    },
    logStepStart(msg: string) {
      line(c.cyan(symbols.start), msg);
    },
    logStepProgress(_msg: string) {
      // no-op
    },
    logStepSuccess(msg: string) {
      line(c.green(symbols.success), msg);
    },
    logStepFail(msg: string) {
      line(c.red(symbols.fail), msg);
    },
    logInfo(msg: string) {
      line(c.cyan(symbols.info), msg);
    },
    logWarn(msg: string) {
      line(c.yellow(symbols.warn), msg);
    },
    logError(msg: string) {
      line(c.red(symbols.fail), msg);
    },
    printSummaryBox(summary: Summary) {
      const stripAnsi = (s: string) => s.replace(/\x1B\[[0-9;]*m/g, "");
      const visibleLen = (s: string) => stripAnsi(s).length;

      const statusColor =
        summary.status === "Success"
          ? c.green
          : summary.status === "Partial"
          ? c.yellow
          : c.red;

      const baseLines: string[] = [];
      baseLines.push(c.bold("SUMMARY"));
      baseLines.push(`Status: ${statusColor(summary.status)}`);
      baseLines.push(
        `Users imported: ${String(summary.imported)}/${String(summary.total)}`
      );
      baseLines.push(`Duration: ${summary.durationMs} ms`);
      baseLines.push(`Warnings: ${String(summary.warnings)}`);
      baseLines.push(`Errors: ${String(summary.errors)}`);

      const minInnerWidth = 28;
      const termCols = (process.stdout.isTTY && process.stdout.columns) || 80;
      const maxInnerWidth = Math.max(10, termCols - 2);
      const contentMax = baseLines.reduce(
        (m, line) => Math.max(m, visibleLen(line)),
        0
      );
      const innerWidth = Math.min(
        Math.max(minInnerWidth, contentMax + 2),
        maxInnerWidth
      );

      const top = `┌${"─".repeat(innerWidth)}┐`;
      const bottom = `└${"─".repeat(innerWidth)}┘`;

      const lineText = (text: string) => {
        const maxContent = innerWidth - 2;
        let content = text;
        if (visibleLen(content) > maxContent) {
          const raw = stripAnsi(content);
          content = raw.slice(0, maxContent);
        }
        const padLen = Math.max(0, maxContent - visibleLen(content));
        return `│ ${content}${" ".repeat(padLen)} │`;
      };

      emit(top);
      for (const l of baseLines) emit(lineText(l));
      emit(bottom);
    },
  };
}

export type Logger = ReturnType<typeof createLogger>;
