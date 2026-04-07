export type LogLevel = "debug" | "info" | "warn" | "error";

export interface ResolvedConfig {
  app: {
    pollIntervalSeconds: number;
    workRoot: string;
    logLevel: LogLevel;
  };
  disc: {
    driveSelector: string;
    stableInsertSeconds: number;
    ripMinSeconds: number;
  };
  series: {
    showTitle: string;
    seasonNumber: number;
    language: string;
  };
  matching: {
    episodeMinSeconds: number;
    extrasFolderName: string;
    acceptMultiEpisode: boolean;
    stitchedTitleMultiplier: number;
  };
  openai: {
    apiKey: string;
    model: string;
    baseUrl: string;
  };
  tmdb: {
    apiKey: string;
    baseUrl: string;
  };
  makemkv: {
    binaryPath: string;
  };
  handbrake: {
    binaryPath: string;
    presetName: string;
    presetImportFile: string | null;
  };
  ffprobe: {
    binaryPath: string;
  };
  paths: {
    libraryRoot: string;
  };
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CommandRunner {
  run(
    command: string,
    args: string[],
    options?: {
      cwd?: string;
      env?: NodeJS.ProcessEnv;
      stdin?: string;
    }
  ): Promise<CommandResult>;
}

export interface DiscTitleScan {
  titleId: number;
  sourceOrder: number;
  reportedDurationSeconds?: number;
  rawAttributes: Record<string, string>;
}

export interface DiscScan {
  discLabel: string;
  rawOutput: string;
  titles: DiscTitleScan[];
}

export interface RippedTitle {
  titleIndex: number;
  sourceOrder: number;
  filePath: string;
  fileName: string;
  sizeBytes: number;
  durationSeconds: number;
  makeMkvTitleId?: number;
  reportedDurationSeconds?: number;
}

export interface SeasonEpisode {
  seasonNumber: number;
  episodeNumber: number;
  name: string;
  runtimeMinutes?: number;
  airDate?: string;
}

export interface DiscMatchRequest {
  showTitle: string;
  seasonNumber: number;
  discLabel: string;
  episodeMinSeconds: number;
  rippedTitles: RippedTitle[];
  candidateEpisodes: SeasonEpisode[];
}

export type TitleClassification =
  | "episode"
  | "multi_episode"
  | "extra"
  | "unmapped";

export interface TitleMapping {
  titleIndex: number;
  classification: TitleClassification;
  seasonNumber?: number;
  episodeNumbers: number[];
  reason: string;
}

export interface DiscMatchResponse {
  discLabel: string;
  titles: TitleMapping[];
}

export type TitleJobStatus =
  | "pending"
  | "encoding"
  | "encoded"
  | "moved"
  | "review"
  | "conflict"
  | "failed";

export interface EncodeJob {
  titleIndex: number;
  sourcePath: string;
  encodedPath: string;
  finalPath: string;
  classification: TitleClassification;
  episodeNumbers: number[];
}

export interface TitleJobRecord {
  titleIndex: number;
  sourcePath: string;
  encodedPath?: string;
  finalPath?: string;
  classification: TitleClassification;
  episodeNumbers: number[];
  status: TitleJobStatus;
  reason: string;
  error?: string;
}

export interface JobManifest {
  version: number;
  jobId: string;
  createdAt: string;
  updatedAt: string;
  status:
    | "disc_detected"
    | "scanning"
    | "ripping"
    | "probing"
    | "matching"
    | "encoding"
    | "moving"
    | "cleanup"
    | "completed"
    | "failed";
  discLabel: string;
  showTitle: string;
  seasonNumber: number;
  workDir: string;
  ripDir: string;
  encodedDir: string;
  reviewDir: string;
  scan?: DiscScan;
  rippedTitles: RippedTitle[];
  mappings: TitleMapping[];
  titleJobs: TitleJobRecord[];
  errors: string[];
}

export interface PipelineLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export interface DiscPresence {
  present: boolean;
  descriptor?: string;
  rawOutput: string;
}

export interface DiscMonitor {
  poll(): Promise<DiscPresence>;
  waitForStableInsertion(): Promise<DiscPresence>;
  waitForRemoval(): Promise<void>;
}
