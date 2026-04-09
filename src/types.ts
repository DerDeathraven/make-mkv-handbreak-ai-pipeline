export type LogLevel = "debug" | "info" | "warn" | "error";

export type WebhookEventName =
  | "job.disc_detected"
  | "job.scanning"
  | "job.ripping"
  | "job.probing"
  | "job.matching"
  | "job.encoding"
  | "job.moving"
  | "job.completed"
  | "job.failed"
  | "title.moved"
  | "title.skipped"
  | "title.review"
  | "title.conflict"
  | "title.failed";

export interface WebhookEndpointConfig {
  url: string;
}

export interface WebhookConfig {
  enabled: boolean;
  timeoutMs: number;
  maxRetries: number;
  retryBackoffMs: number;
  events: Partial<Record<WebhookEventName, WebhookEndpointConfig[]>>;
}

export interface WebhookJobPayload {
  event: WebhookEventName;
  timestamp: string;
  job_id: string;
  job_status: JobManifest["status"];
  disc_label: string;
  show_title: string;
  season_number: number;
}

export interface WebhookTitlePayload extends WebhookJobPayload {
  title_index: number;
  title_status: TitleJobStatus;
  classification: TitleClassification;
  episode_numbers: number[];
}

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
  webhooks: WebhookConfig;
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
  lastCompletedEpisodeNumber?: number;
  rippedTitles: RippedTitle[];
  candidateEpisodes: SeasonEpisode[];
}

export type TitleClassification =
  | "episode"
  | "multi_episode"
  | "skip"
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
  | "skipped"
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

export interface SeriesProgressRecord {
  key: string;
  showTitle: string;
  seasonNumber: number;
  lastCompletedEpisodeNumber: number;
  lastUpdatedAt: string;
  lastJobId: string;
  lastDiscLabel: string;
}
