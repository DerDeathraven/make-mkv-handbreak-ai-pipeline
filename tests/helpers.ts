import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import type { PipelineLogger, ResolvedConfig } from "../src/types";

export const noopLogger: PipelineLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

export async function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function removeTempDir(dirPath: string): Promise<void> {
  await rm(dirPath, { recursive: true, force: true });
}

export function createTestConfig(rootDir: string): ResolvedConfig {
  return {
    app: {
      pollIntervalSeconds: 1,
      workRoot: path.join(rootDir, "work"),
      logLevel: "info"
    },
    disc: {
      driveSelector: "disc:0",
      stableInsertSeconds: 1,
      ripMinSeconds: 120
    },
    series: {
      showTitle: "Example Show",
      seasonNumber: 1,
      language: "en-US"
    },
    matching: {
      episodeMinSeconds: 900,
      extrasFolderName: "Extras",
      acceptMultiEpisode: true,
      stitchedTitleMultiplier: 2.5
    },
    openai: {
      apiKey: "test-openai-key",
      model: "gpt-5-mini",
      baseUrl: "https://api.openai.com/v1"
    },
    tmdb: {
      apiKey: "test-tmdb-key",
      baseUrl: "https://api.themoviedb.org/3"
    },
    makemkv: {
      binaryPath: "/tmp/makemkvcon"
    },
    handbrake: {
      binaryPath: "/tmp/HandBrakeCLI",
      presetName: "Fast 1080p30",
      presetImportFile: null
    },
    ffprobe: {
      binaryPath: "/tmp/ffprobe"
    },
    paths: {
      libraryRoot: path.join(rootDir, "library")
    }
  };
}
