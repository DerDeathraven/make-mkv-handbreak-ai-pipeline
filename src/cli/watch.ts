import path from "node:path";
import { access, readFile } from "node:fs/promises";
import type { ResolvedConfig } from "../types";
import { OpenAiMatcher } from "../ai/openai";
import { PipelineService } from "../app/pipeline";
import { loadConfig } from "../config/schema";
import { PollingDiscMonitor } from "../disc/monitor";
import { MakeMkvService } from "../disc/makemkv";
import { HandBrakeService } from "../encode/handbrake";
import { JobManifestStore } from "../jobs/manifest";
import { createLogger } from "../logging/logger";
import { TmdbClient } from "../metadata/tmdb";
import { FfprobeService } from "../media/ffprobe";
import { NodeCommandRunner } from "../utils/command";

function parseOption(args: string[], optionName: string): string | undefined {
  const index = args.findIndex((arg) => arg === optionName);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

function parseRequiredOption(args: string[], optionName: string): string {
  const value = parseOption(args, optionName);
  if (!value) {
    throw new Error(`Missing required option ${optionName}`);
  }
  return value;
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(path.resolve(filePath), "utf8")) as T;
}

async function buildService(configPath: string): Promise<{
  service: PipelineService;
  config: ResolvedConfig;
}> {
  const config = await loadConfig(configPath);
  const logger = await createLogger(config.app.workRoot, config.app.logLevel);
  const runner = new NodeCommandRunner();
  const service = new PipelineService({
    config,
    logger,
    monitor: new PollingDiscMonitor(runner, config, logger),
    makeMkv: new MakeMkvService(runner, config, logger),
    ffprobe: new FfprobeService(runner, config, logger),
    tmdb: new TmdbClient(config, logger),
    openai: new OpenAiMatcher(config, logger),
    handbrake: new HandBrakeService(runner, config, logger),
    manifestStore: new JobManifestStore(config.app.workRoot)
  });
  return { service, config };
}

export async function runCli(argv: string[]): Promise<void> {
  const [command = "watch", ...args] = argv;
  const configPath = parseOption(args, "--config") ?? path.resolve("config.yaml");
  const { service } = await buildService(configPath);

  if (command === "validate-config") {
    await service.validateEnvironment();
    process.stdout.write(`Configuration is valid: ${configPath}\n`);
    return;
  }

  if (command === "dry-run-match") {
    const discLabel = parseRequiredOption(args, "--disc-label");
    const titlesJsonPath = parseRequiredOption(args, "--titles-json");
    await access(titlesJsonPath);
    const moduleData = await readJsonFile<
      Array<{
        titleIndex: number;
        sourceOrder?: number;
        filePath?: string;
        fileName?: string;
        sizeBytes?: number;
        durationSeconds: number;
      }>
    >(titlesJsonPath);
    const titles = moduleData.map((title) => ({
      titleIndex: title.titleIndex,
      sourceOrder: title.sourceOrder ?? title.titleIndex,
      filePath: title.filePath ?? `/tmp/title-${title.titleIndex}.mkv`,
      fileName: title.fileName ?? `title-${title.titleIndex}.mkv`,
      sizeBytes: title.sizeBytes ?? 0,
      durationSeconds: title.durationSeconds
    }));
    const mappings = await service.dryRunMatch(discLabel, titles);
    process.stdout.write(`${JSON.stringify(mappings, null, 2)}\n`);
    return;
  }

  if (command === "watch") {
    await service.runWatchLoop();
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}
