import { spawn } from "node:child_process";
import path from "node:path";
import { stat } from "node:fs/promises";
import type {
  CommandRunner,
  DiscScan,
  DiscTitleScan,
  PipelineLogger,
  ResolvedConfig,
  RippedTitle
} from "../types";
import { listFilesWithExtension } from "../utils/fs";
import { assertSuccess } from "../utils/command";

type MakeMkvProgressEvent =
  | {
      type: "current_label";
      name: string;
    }
  | {
      type: "total_label";
      name: string;
    }
  | {
      type: "progress";
      current: number;
      total: number;
      max: number;
      currentPercent: number;
      totalPercent: number;
    }
  | {
      type: "message";
      code: number;
      message: string;
    };

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      const nextChar = line[index + 1];
      if (quoted && nextChar === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === "," && !quoted) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

function parseDurationSeconds(value: string): number | undefined {
  const trimmed = value.trim();
  const parts = trimmed.split(":").map((part) => Number(part));
  if (parts.length === 3 && parts.every((part) => Number.isFinite(part))) {
    return (parts[0] * 60 + parts[1]) * 60 + parts[2];
  }
  return undefined;
}

export function parseMakeMkvProgressLine(line: string): MakeMkvProgressEvent | null {
  if (line.startsWith("PRGC:")) {
    const payload = parseCsvLine(line.slice(5));
    return {
      type: "current_label",
      name: payload[2]?.replace(/^"|"$/g, "") ?? "Current operation"
    };
  }

  if (line.startsWith("PRGT:")) {
    const payload = parseCsvLine(line.slice(5));
    return {
      type: "total_label",
      name: payload[2]?.replace(/^"|"$/g, "") ?? "Total progress"
    };
  }

  if (line.startsWith("PRGV:")) {
    const payload = parseCsvLine(line.slice(5));
    const current = Number(payload[0]);
    const total = Number(payload[1]);
    const max = Number(payload[2]);
    if (!Number.isFinite(current) || !Number.isFinite(total) || !Number.isFinite(max) || max <= 0) {
      return null;
    }
    return {
      type: "progress",
      current,
      total,
      max,
      currentPercent: (current / max) * 100,
      totalPercent: (total / max) * 100
    };
  }

  if (line.startsWith("MSG:")) {
    const payload = parseCsvLine(line.slice(4));
    const code = Number(payload[0]);
    const message = payload[3]?.replace(/^"|"$/g, "") ?? "";
    if (!Number.isFinite(code) || !message) {
      return null;
    }
    return {
      type: "message",
      code,
      message
    };
  }

  return null;
}

export function parseMakeMkvInfoOutput(stdout: string): DiscScan {
  const titles = new Map<number, DiscTitleScan>();
  let discLabel = "UNKNOWN_DISC";

  for (const line of stdout.split(/\r?\n/)) {
    if (!line) {
      continue;
    }

    if (line.startsWith("DRV:")) {
      const payload = parseCsvLine(line.slice(4));
      const lastField = payload.at(-1)?.trim();
      if (lastField) {
        discLabel = lastField.replace(/^"|"$/g, "");
      }
      continue;
    }

    if (!line.startsWith("TINFO:")) {
      continue;
    }

    const payload = parseCsvLine(line.slice(6));
    const titleId = Number(payload[0]);
    const attributeCode = payload[1];
    const rawValue = payload[2] ?? "";
    if (!Number.isFinite(titleId)) {
      continue;
    }

    const existing =
      titles.get(titleId) ??
      {
        titleId,
        sourceOrder: titleId + 1,
        rawAttributes: {}
      };
    existing.rawAttributes[attributeCode] = rawValue;
    existing.reportedDurationSeconds ??= parseDurationSeconds(rawValue);
    titles.set(titleId, existing);
  }

  return {
    discLabel,
    rawOutput: stdout,
    titles: [...titles.values()].sort((left, right) => left.titleId - right.titleId)
  };
}

function inferTitleIdFromFilename(fileName: string): number | undefined {
  const match = fileName.match(/t(\d{1,3})/i) ?? fileName.match(/title[_ -]?(\d{1,3})/i);
  if (!match) {
    return undefined;
  }
  return Number(match[1]);
}

export class MakeMkvService {
  constructor(
    private readonly runner: CommandRunner,
    private readonly config: ResolvedConfig,
    private readonly logger: PipelineLogger
  ) {}

  async scanDisc(): Promise<DiscScan> {
    const args = ["-r", "info", this.config.disc.driveSelector];
    this.logger.info("Scanning disc with MakeMKV");
    const result = await this.runner.run(this.config.makemkv.binaryPath, args);
    assertSuccess(this.config.makemkv.binaryPath, args, result);
    return parseMakeMkvInfoOutput(result.stdout);
  }

  async ripTitles(outputDir: string, titleIds: number[]): Promise<void> {
    const selectedTitleIds = [...titleIds].sort((left, right) => left - right);
    const ripTargets: Array<number | "all"> = selectedTitleIds.length ? selectedTitleIds : ["all"];

    this.logger.info("Ripping disc with MakeMKV", {
      outputDir,
      titleCount: selectedTitleIds.length || "all",
      note: "This may take several minutes depending on the disc."
    });

    for (let index = 0; index < ripTargets.length; index += 1) {
      const target = ripTargets[index];
      const args = [
        "-r",
        "--messages=stdout",
        "--progress=-same",
        `--minlength=${this.config.disc.ripMinSeconds}`,
        "mkv",
        this.config.disc.driveSelector,
        String(target),
        outputDir
      ];

      this.logger.info("Starting MakeMKV title rip", {
        title: target,
        progress: `${index + 1}/${ripTargets.length}`
      });
      await this.runRipCommand(args);
    }

    this.logger.info("MakeMKV rip finished", { outputDir });
  }

  private async runRipCommand(args: string[]): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(this.config.makemkv.binaryPath, args, {
        stdio: ["ignore", "pipe", "pipe"]
      });

      let stdout = "";
      let stderr = "";
      let stdoutBuffer = "";
      let stderrBuffer = "";
      let currentLabel = "Current operation";
      let totalLabel = "Total progress";
      let lastLoggedTotalBucket = -1;
      let lastProgressLogTime = 0;
      const startedAt = Date.now();

      const heartbeat = setInterval(() => {
        const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
        this.logger.info("Rip still running", {
          elapsedSeconds,
          stage: totalLabel,
          currentTask: currentLabel
        });
      }, 30000);

      const flushBufferedLine = (chunkBuffer: string, onLine: (line: string) => void): string => {
        let buffer = chunkBuffer;
        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex !== -1) {
          const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
          onLine(line);
          buffer = buffer.slice(newlineIndex + 1);
          newlineIndex = buffer.indexOf("\n");
        }
        return buffer;
      };

      const handleProgressLine = (line: string): void => {
        if (!line.trim()) {
          return;
        }

        const parsed = parseMakeMkvProgressLine(line);
        if (!parsed) {
          this.logger.debug("MakeMKV output", { line });
          return;
        }

        if (parsed.type === "current_label") {
          currentLabel = parsed.name;
          this.logger.info("MakeMKV task updated", { currentTask: currentLabel });
          return;
        }

        if (parsed.type === "total_label") {
          totalLabel = parsed.name;
          this.logger.info("MakeMKV overall stage updated", { stage: totalLabel });
          return;
        }

        if (parsed.type === "message") {
          this.logger.info("MakeMKV message", { code: parsed.code, text: parsed.message });
          return;
        }

        const totalBucket = Math.floor(parsed.totalPercent / 5);
        const now = Date.now();
        if (
          totalBucket !== lastLoggedTotalBucket ||
          now - lastProgressLogTime >= 15000 ||
          parsed.totalPercent >= 100
        ) {
          lastLoggedTotalBucket = totalBucket;
          lastProgressLogTime = now;
          this.logger.info("Rip progress", {
            stage: totalLabel,
            currentTask: currentLabel,
            totalPercent: Number(parsed.totalPercent.toFixed(1)),
            currentPercent: Number(parsed.currentPercent.toFixed(1))
          });
        }
      };

      child.stdout.on("data", (chunk: Buffer | string) => {
        const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        stdout += text;
        stdoutBuffer += text;
        stdoutBuffer = flushBufferedLine(stdoutBuffer, handleProgressLine);
      });

      child.stderr.on("data", (chunk: Buffer | string) => {
        const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        stderr += text;
        stderrBuffer += text;
        stderrBuffer = flushBufferedLine(stderrBuffer, (line) => {
          if (line.trim()) {
            this.logger.warn("MakeMKV stderr", { line });
          }
        });
      });

      child.on("error", (error) => {
        clearInterval(heartbeat);
        reject(error);
      });

      child.on("close", (code) => {
        clearInterval(heartbeat);

        if (stdoutBuffer.trim()) {
          handleProgressLine(stdoutBuffer.trim());
        }
        if (stderrBuffer.trim()) {
          this.logger.warn("MakeMKV stderr", { line: stderrBuffer.trim() });
        }

        const result = {
          stdout,
          stderr,
          exitCode: code ?? 1
        };

        try {
          assertSuccess(this.config.makemkv.binaryPath, args, result);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  async buildRippedTitleList(
    ripDir: string,
    scan: DiscScan
  ): Promise<Omit<RippedTitle, "durationSeconds">[]> {
    const files = await listFilesWithExtension(ripDir, ".mkv");
    return Promise.all(
      files.map(async (filePath, index) => {
        const fileName = path.basename(filePath);
        const fileStat = await stat(filePath);
        const inferredTitleId = inferTitleIdFromFilename(fileName);
        const matchingScan = scan.titles.find((title) => title.titleId === inferredTitleId);
        return {
          titleIndex: index + 1,
          sourceOrder: index + 1,
          filePath,
          fileName,
          makeMkvTitleId: inferredTitleId,
          reportedDurationSeconds: matchingScan?.reportedDurationSeconds,
          sizeBytes: fileStat.size
        };
      })
    );
  }
}
