import { readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import type { ResolvedConfig } from "../types";

const logLevelSchema = z.enum(["debug", "info", "warn", "error"]);

const configSchema = z.object({
  app: z
    .object({
      poll_interval_seconds: z.number().int().positive().default(5),
      work_root: z.string().min(1).default("./work"),
      log_level: logLevelSchema.default("info")
    })
    .default({
      poll_interval_seconds: 5,
      work_root: "./work",
      log_level: "info"
    }),
  disc: z.object({
    drive_selector: z.string().min(1).default("disc:0"),
    stable_insert_seconds: z.number().int().positive().default(10),
    rip_min_seconds: z.number().int().nonnegative().default(120)
  }),
  series: z.object({
    show_title: z.string().min(1),
    season_number: z.number().int().positive(),
    language: z.string().min(2).default("en-US")
  }),
  matching: z
    .object({
      episode_min_seconds: z.number().int().positive().default(700),
      extras_folder_name: z.string().min(1).default("Extras"),
      accept_multi_episode: z.boolean().default(true),
      stitched_title_multiplier: z.number().positive().default(2.5)
    })
    .default({
      episode_min_seconds: 700,
      extras_folder_name: "Extras",
      accept_multi_episode: true,
      stitched_title_multiplier: 2.5
    }),
  openai: z.object({
    api_key: z.string().optional(),
    model: z.string().min(1).default("gpt-5-mini"),
    base_url: z.string().url().nullable().default("https://api.openai.com/v1")
  }),
  tmdb: z.object({
    api_key: z.string().optional(),
    base_url: z.string().url().default("https://api.themoviedb.org/3")
  }),
  makemkv: z.object({
    binary_path: z.string().min(1)
  }),
  handbrake: z.object({
    binary_path: z.string().min(1),
    preset_name: z.string().min(1),
    preset_import_file: z.string().nullable().default(null)
  }),
  ffprobe: z.object({
    binary_path: z.string().min(1)
  }),
  paths: z.object({
    library_root: z.string().min(1)
  })
});

function resolveSecret(value: string | undefined, envName: string): string {
  const candidate = value && value.trim() ? value.trim() : `env:${envName}`;
  if (candidate.startsWith("env:")) {
    const variableName = candidate.slice("env:".length);
    const resolved = process.env[variableName];
    if (!resolved) {
      throw new Error(`Missing required environment variable ${variableName}`);
    }
    return resolved;
  }
  return candidate;
}

export async function loadConfig(configPath: string): Promise<ResolvedConfig> {
  const rawText = await readFile(configPath, "utf8");
  const parsedYaml = YAML.parse(rawText) ?? {};
  const parsed = configSchema.parse(parsedYaml);
  const baseDir = path.dirname(path.resolve(configPath));
  const resolvePath = (inputPath: string): string =>
    path.isAbsolute(inputPath) ? inputPath : path.resolve(baseDir, inputPath);

  return {
    app: {
      pollIntervalSeconds: parsed.app.poll_interval_seconds,
      workRoot: resolvePath(parsed.app.work_root),
      logLevel: parsed.app.log_level
    },
    disc: {
      driveSelector: parsed.disc.drive_selector,
      stableInsertSeconds: parsed.disc.stable_insert_seconds,
      ripMinSeconds: parsed.disc.rip_min_seconds
    },
    series: {
      showTitle: parsed.series.show_title,
      seasonNumber: parsed.series.season_number,
      language: parsed.series.language
    },
    matching: {
      episodeMinSeconds: parsed.matching.episode_min_seconds,
      extrasFolderName: parsed.matching.extras_folder_name,
      acceptMultiEpisode: parsed.matching.accept_multi_episode,
      stitchedTitleMultiplier: parsed.matching.stitched_title_multiplier
    },
    openai: {
      apiKey: resolveSecret(parsed.openai.api_key, "OPENAI_API_KEY"),
      model: parsed.openai.model,
      baseUrl: parsed.openai.base_url ?? "https://api.openai.com/v1"
    },
    tmdb: {
      apiKey: resolveSecret(parsed.tmdb.api_key, "TMDB_API_KEY"),
      baseUrl: parsed.tmdb.base_url
    },
    makemkv: {
      binaryPath: resolvePath(parsed.makemkv.binary_path)
    },
    handbrake: {
      binaryPath: resolvePath(parsed.handbrake.binary_path),
      presetName: parsed.handbrake.preset_name,
      presetImportFile: parsed.handbrake.preset_import_file
        ? resolvePath(parsed.handbrake.preset_import_file)
        : null
    },
    ffprobe: {
      binaryPath: resolvePath(parsed.ffprobe.binary_path)
    },
    paths: {
      libraryRoot: resolvePath(parsed.paths.library_root)
    }
  };
}
