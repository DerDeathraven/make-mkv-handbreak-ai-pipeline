import { appendFileSync } from "node:fs";
import path from "node:path";
import type { LogLevel, PipelineLogger } from "../types";
import { ensureDir } from "../utils/fs";

const levelPriority: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

export async function createLogger(
  workRoot: string,
  level: LogLevel
): Promise<PipelineLogger> {
  const logDir = path.join(workRoot, "logs");
  await ensureDir(logDir);
  const logFile = path.join(logDir, "pipeline.jsonl");

  const write = (entryLevel: LogLevel, message: string, data?: Record<string, unknown>): void => {
    if (levelPriority[entryLevel] < levelPriority[level]) {
      return;
    }

    const payload = {
      timestamp: new Date().toISOString(),
      level: entryLevel,
      message,
      ...data
    };
    const line = JSON.stringify(payload);
    appendFileSync(logFile, `${line}\n`, "utf8");
    const summary = data ? ` ${JSON.stringify(data)}` : "";
    const stream = entryLevel === "error" ? process.stderr : process.stdout;
    stream.write(`[${payload.timestamp}] ${entryLevel.toUpperCase()} ${message}${summary}\n`);
  };

  return {
    debug: (message, data) => write("debug", message, data),
    info: (message, data) => write("info", message, data),
    warn: (message, data) => write("warn", message, data),
    error: (message, data) => write("error", message, data)
  };
}
