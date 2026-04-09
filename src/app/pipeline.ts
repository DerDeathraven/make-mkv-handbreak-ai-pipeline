import path from "node:path";
import { stat } from "node:fs/promises";
import type {
  CommandRunner,
  DiscPresence,
  DiscScan,
  DiscMonitor,
  JobManifest,
  PipelineLogger,
  ResolvedConfig,
  RippedTitle,
  SeasonEpisode,
  TitleJobRecord,
  TitleMapping
} from "../types";
import { OpenAiMatcher } from "../ai/openai";
import { MakeMkvService } from "../disc/makemkv";
import { selectTitlesForRip } from "../disc/title-selection";
import { HandBrakeService } from "../encode/handbrake";
import { JobManifestStore } from "../jobs/manifest";
import { buildDestinationPath } from "../naming/jellyfin";
import { TmdbClient } from "../metadata/tmdb";
import { FfprobeService } from "../media/ffprobe";
import { buildDiscMatchRequest, buildEpisodeLookup, validateAndNormalizeMappings } from "../matching/mapper";
import { WebhookDispatcher } from "../notifications/webhooks";
import { SeriesProgressStore } from "../state/series-progress";
import { ensureDir, fileExists, moveFile, removeFileIfExists, writeTextFile } from "../utils/fs";

interface PipelineDependencies {
  config: ResolvedConfig;
  logger: PipelineLogger;
  runner: CommandRunner;
  monitor: DiscMonitor;
  makeMkv: MakeMkvService;
  ffprobe: FfprobeService;
  tmdb: TmdbClient;
  openai: OpenAiMatcher;
  handbrake: HandBrakeService;
  manifestStore: JobManifestStore;
  seriesProgressStore: SeriesProgressStore;
  webhooks: WebhookDispatcher;
}

function createJobId(discLabel: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeLabel = discLabel
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `${timestamp}-${safeLabel || "disc"}`;
}

function createManifest(
  config: ResolvedConfig,
  discLabel: string
): JobManifest {
  const jobId = createJobId(discLabel);
  const workDir = path.join(config.app.workRoot, "jobs", jobId);
  return {
    version: 1,
    jobId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "disc_detected",
    discLabel,
    showTitle: config.series.showTitle,
    seasonNumber: config.series.seasonNumber,
    workDir,
    ripDir: path.join(workDir, "rip"),
    encodedDir: path.join(workDir, "encoded"),
    reviewDir: path.join(workDir, "review"),
    rippedTitles: [],
    mappings: [],
    titleJobs: [],
    errors: []
  };
}

async function verifyFileReadable(targetPath: string): Promise<void> {
  const fileStat = await stat(targetPath);
  if (!fileStat.isFile() || fileStat.size <= 0) {
    throw new Error(`Output file is missing or empty: ${targetPath}`);
  }
}

export class PipelineService {
  constructor(private readonly deps: PipelineDependencies) {}

  async validateEnvironment(): Promise<void> {
    const {
      config,
      logger
    } = this.deps;
    await ensureDir(config.app.workRoot);
    await ensureDir(config.paths.libraryRoot);

    const requiredPaths = [
      config.makemkv.binaryPath,
      config.handbrake.binaryPath,
      config.ffprobe.binaryPath
    ];

    for (const binaryPath of requiredPaths) {
      if (!(await fileExists(binaryPath))) {
        throw new Error(`Required binary not found: ${binaryPath}`);
      }
    }

    if (config.handbrake.presetImportFile && !(await fileExists(config.handbrake.presetImportFile))) {
      throw new Error(`Preset import file not found: ${config.handbrake.presetImportFile}`);
    }

    logger.info("Environment validation succeeded");
  }

  async resumePendingJobs(): Promise<void> {
    const manifests = await this.deps.manifestStore.listPending();
    for (const manifest of manifests) {
      this.deps.logger.info("Resuming pending manifest", {
        jobId: manifest.jobId,
        status: manifest.status
      });
      await this.processTitleJobs(manifest);
    }
  }

  async runWatchLoop(): Promise<void> {
    await this.validateEnvironment();
    await this.resumePendingJobs();
    for (;;) {
      const presence = await this.deps.monitor.waitForStableInsertion();
      try {
        await this.processDetectedDisc(presence);
      } catch (error) {
        this.deps.logger.error("Disc processing failed", {
          error: error instanceof Error ? error.message : String(error)
        });
      }
      await this.deps.monitor.waitForRemoval();
    }
  }

  async processDetectedDisc(_presence: DiscPresence): Promise<JobManifest> {
    const scan = await this.deps.makeMkv.scanDisc();
    const manifest = createManifest(this.deps.config, scan.discLabel);
    await ensureDir(manifest.workDir);
    await ensureDir(manifest.ripDir);
    await ensureDir(manifest.encodedDir);
    await ensureDir(manifest.reviewDir);
    await this.setJobStatus(manifest, "disc_detected", true);

    try {
      manifest.scan = scan;
      await this.setJobStatus(manifest, "scanning");

      const seriesProgress = await this.deps.seriesProgressStore.get(
        this.deps.config.series.showTitle,
        this.deps.config.series.seasonNumber
      );
      if (seriesProgress) {
        this.deps.logger.info("Loaded season progress from previous runs", {
          lastCompletedEpisodeNumber: seriesProgress.lastCompletedEpisodeNumber,
          lastJobId: seriesProgress.lastJobId,
          lastDiscLabel: seriesProgress.lastDiscLabel
        });
      }

      let seasonEpisodes: SeasonEpisode[] = [];
      try {
        seasonEpisodes = await this.deps.tmdb.getSeasonEpisodes();
      } catch (error) {
        this.deps.logger.warn("TMDb lookup unavailable before rip filtering", {
          error: error instanceof Error ? error.message : String(error)
        });
      }

      await this.ripAndProbeTitles(manifest, scan, seasonEpisodes);
      await this.matchTitles(manifest, seasonEpisodes, seriesProgress?.lastCompletedEpisodeNumber);
      await this.processTitleJobs(manifest);
    } catch (error) {
      manifest.errors.push(error instanceof Error ? error.message : String(error));
      await this.setJobStatus(manifest, "failed");
      throw error;
    }
    return manifest;
  }

  async dryRunMatch(discLabel: string, rippedTitles: RippedTitle[]): Promise<TitleMapping[]> {
    const episodes = await this.deps.tmdb.getSeasonEpisodes();
    const request = buildDiscMatchRequest(
      this.deps.config.series.showTitle,
      this.deps.config.series.seasonNumber,
      this.deps.config.matching.episodeMinSeconds,
      discLabel,
      rippedTitles,
      episodes
    );
    const aiResponse = await this.deps.openai.matchDisc(request);
    return validateAndNormalizeMappings(request, aiResponse);
  }

  async runSmokeTest(): Promise<{
    handbrakeVersion: string;
    ffprobeVersion: string;
    tmdbEpisodeCount: number;
    openAiMappingCount: number;
    destinationTestFile: string;
  }> {
    await this.validateEnvironment();
    const smokeTestManifest = createManifest(this.deps.config, "SMOKE_TEST_DISC");

    const handbrakeVersion = await this.runCommandForSummary(
      this.deps.config.handbrake.binaryPath,
      ["--version"]
    );
    const ffprobeVersion = await this.runCommandForSummary(
      this.deps.config.ffprobe.binaryPath,
      ["-version"]
    );

    const seasonEpisodes = await this.deps.tmdb.getSeasonEpisodes();
    if (!seasonEpisodes.length) {
      throw new Error("TMDb smoke test returned no episodes for the configured season");
    }

    const syntheticTitles: RippedTitle[] = seasonEpisodes.slice(0, 2).map((episode, index) => ({
      titleIndex: index + 1,
      sourceOrder: index + 1,
      filePath: path.join(this.deps.config.app.workRoot, `smoke-test-title-${index + 1}.mkv`),
      fileName: `smoke-test-title-${index + 1}.mkv`,
      sizeBytes: 0,
      durationSeconds: Math.max(
        this.deps.config.matching.episodeMinSeconds,
        (episode.runtimeMinutes ?? 22) * 60
      )
    }));

    const request = buildDiscMatchRequest(
      this.deps.config.series.showTitle,
      this.deps.config.series.seasonNumber,
      this.deps.config.matching.episodeMinSeconds,
      "SMOKE_TEST_DISC",
      syntheticTitles,
      seasonEpisodes
    );
    smokeTestManifest.rippedTitles = syntheticTitles;
    await this.setJobStatus(smokeTestManifest, "matching", true);
    const openAiResponse = await this.deps.openai.matchDisc(request);
    const validatedMappings = validateAndNormalizeMappings(request, openAiResponse);

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const localProbeFile = path.join(
      this.deps.config.app.workRoot,
      "smoke-tests",
      timestamp,
      "write-test.txt"
    );
    const destinationTestFile = path.join(
      this.deps.config.paths.libraryRoot,
      "_pipeline-smoketest",
      timestamp,
      "write-test.txt"
    );

    await writeTextFile(
      localProbeFile,
      [
        "Pipeline smoke test",
        `Timestamp: ${new Date().toISOString()}`,
        `Show: ${this.deps.config.series.showTitle}`,
        `Season: ${this.deps.config.series.seasonNumber}`
      ].join("\n")
    );
    await moveFile(localProbeFile, destinationTestFile);
    await verifyFileReadable(destinationTestFile);
    await this.setJobStatus(smokeTestManifest, "completed", true);

    return {
      handbrakeVersion,
      ffprobeVersion,
      tmdbEpisodeCount: seasonEpisodes.length,
      openAiMappingCount: validatedMappings.length,
      destinationTestFile
    };
  }

  async retryReviewJob(jobId: string): Promise<JobManifest> {
    const manifest = await this.deps.manifestStore.loadByJobId(jobId);
    await ensureDir(manifest.ripDir);
    await ensureDir(manifest.reviewDir);
    await this.restoreRetryableSources(manifest);
    await this.rematchRetryableTitles(manifest);
    await this.processTitleJobs(manifest);
    return manifest;
  }

  private async ripAndProbeTitles(
    manifest: JobManifest,
    scan: DiscScan,
    seasonEpisodes: SeasonEpisode[]
  ): Promise<void> {
    await this.setJobStatus(manifest, "ripping");

    const selection = selectTitlesForRip(
      scan.titles,
      seasonEpisodes,
      this.deps.config.matching.episodeMinSeconds,
      this.deps.config.matching.stitchedTitleMultiplier
    );

    if (selection.skippedTitles.length) {
      this.deps.logger.info("Skipping stitched compilation titles before rip", {
        baselineRuntimeSeconds: selection.baselineRuntimeSeconds,
        skipThresholdSeconds: selection.skipThresholdSeconds,
        skippedTitles: selection.skippedTitles
      });
    }

    await this.deps.makeMkv.ripTitles(
      manifest.ripDir,
      selection.selectedTitles.map((title) => title.titleId)
    );

    await this.setJobStatus(manifest, "probing");
    const rippedFiles = await this.deps.makeMkv.buildRippedTitleList(manifest.ripDir, scan);

    const titles: RippedTitle[] = [];
    for (const rippedFile of rippedFiles) {
      const probe = await this.deps.ffprobe.probe(rippedFile.filePath);
      const titleStat = await stat(rippedFile.filePath);
      titles.push({
        ...rippedFile,
        sizeBytes: titleStat.size,
        durationSeconds: probe.durationSeconds
      });
    }

    manifest.rippedTitles = titles;
    await this.deps.manifestStore.save(manifest);
  }

  private async matchTitles(
    manifest: JobManifest,
    preloadedSeasonEpisodes: SeasonEpisode[] = [],
    lastCompletedEpisodeNumber?: number
  ): Promise<void> {
    await this.setJobStatus(manifest, "matching");

    let seasonEpisodes: SeasonEpisode[] = [...preloadedSeasonEpisodes];
    try {
      if (!seasonEpisodes.length) {
        seasonEpisodes = await this.deps.tmdb.getSeasonEpisodes();
      }
      const filteredEpisodes = this.filterEpisodesForSequentialDiscs(
        seasonEpisodes,
        lastCompletedEpisodeNumber
      );
      const request = buildDiscMatchRequest(
        this.deps.config.series.showTitle,
        this.deps.config.series.seasonNumber,
        this.deps.config.matching.episodeMinSeconds,
        manifest.discLabel,
        manifest.rippedTitles,
        filteredEpisodes,
        lastCompletedEpisodeNumber
      );
      const aiResponse = await this.deps.openai.matchDisc(request);
      manifest.mappings = validateAndNormalizeMappings(request, aiResponse);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      manifest.errors.push(`Matching fallback triggered: ${reason}`);
      manifest.mappings = manifest.rippedTitles.map((title) => ({
        titleIndex: title.titleIndex,
        classification: title.durationSeconds < this.deps.config.matching.episodeMinSeconds ? "extra" : "unmapped",
        episodeNumbers: [],
        reason
      }));
    }

    const episodeMap = buildEpisodeLookup(seasonEpisodes);
    manifest.titleJobs = manifest.rippedTitles.map((title) => {
      const mapping =
        manifest.mappings.find((candidate) => candidate.titleIndex === title.titleIndex) ??
        {
          titleIndex: title.titleIndex,
          classification: "unmapped",
          episodeNumbers: [],
          reason: "No valid mapping returned"
        };

      return {
        titleIndex: title.titleIndex,
        sourcePath: title.filePath,
        finalPath:
          mapping.classification === "unmapped" || mapping.classification === "skip"
            ? undefined
            : buildDestinationPath(this.deps.config, manifest.discLabel, title, mapping, episodeMap),
        classification: mapping.classification,
        episodeNumbers: mapping.episodeNumbers,
        status: "pending",
        reason: mapping.reason
      } satisfies TitleJobRecord;
    });

    await this.deps.manifestStore.save(manifest);
  }

  async processTitleJobs(manifest: JobManifest): Promise<void> {
    if (!manifest.titleJobs.length) {
      manifest.errors.push("No title jobs available for processing");
      await this.setJobStatus(manifest, "failed");
      return;
    }

    await this.setJobStatus(manifest, "encoding");

    for (const titleJob of manifest.titleJobs) {
      const sourceTitle = manifest.rippedTitles.find((title) => title.titleIndex === titleJob.titleIndex);
      if (!sourceTitle) {
        titleJob.error = "Ripped source title missing";
        await this.setTitleJobStatus(manifest, titleJob, "failed");
        continue;
      }

      if (
        titleJob.status === "moved" ||
        titleJob.status === "skipped" ||
        titleJob.status === "review" ||
        titleJob.status === "conflict"
      ) {
        continue;
      }

      try {
        if (titleJob.classification === "skip") {
          await removeFileIfExists(titleJob.sourcePath);
          await this.setTitleJobStatus(manifest, titleJob, "skipped");
          continue;
        }

        if (!titleJob.finalPath || titleJob.classification === "unmapped") {
          const reviewPath = await this.moveToReview(manifest, titleJob.sourcePath, titleJob.reason);
          if (reviewPath) {
            titleJob.sourcePath = reviewPath;
            sourceTitle.filePath = reviewPath;
            sourceTitle.fileName = path.basename(reviewPath);
          }
          await this.setTitleJobStatus(manifest, titleJob, "review");
          continue;
        }

        const encodedPath =
          titleJob.encodedPath ??
          this.deps.handbrake.buildEncodedPath(manifest.encodedDir, titleJob.sourcePath);
        titleJob.encodedPath = encodedPath;
        titleJob.status = "encoding";
        await this.deps.manifestStore.save(manifest);

        await this.deps.handbrake.encode(titleJob.sourcePath, encodedPath);
        await verifyFileReadable(encodedPath);
        await this.deps.ffprobe.probe(encodedPath);

        if (await fileExists(titleJob.finalPath)) {
          const conflictPath = path.join(
            manifest.reviewDir,
            "conflicts",
            path.basename(encodedPath)
          );
          await moveFile(encodedPath, conflictPath);
          titleJob.error = `Destination already exists: ${titleJob.finalPath}`;
          await this.setTitleJobStatus(manifest, titleJob, "conflict");
          continue;
        }

        await this.setJobStatus(manifest, "moving");
        await moveFile(encodedPath, titleJob.finalPath);
        await verifyFileReadable(titleJob.finalPath);
        await removeFileIfExists(titleJob.sourcePath);
        await this.setTitleJobStatus(manifest, titleJob, "moved");
        await this.setJobStatus(manifest, "encoding");
      } catch (error) {
        titleJob.error = error instanceof Error ? error.message : String(error);
        manifest.errors.push(`[Title ${titleJob.titleIndex}] ${titleJob.error}`);
        const reviewPath = await this.moveToReview(manifest, titleJob.sourcePath, titleJob.error);
        if (reviewPath) {
          titleJob.sourcePath = reviewPath;
          sourceTitle.filePath = reviewPath;
          sourceTitle.fileName = path.basename(reviewPath);
        }
        await this.setTitleJobStatus(manifest, titleJob, "failed");
      }
    }

    const finalStatus = manifest.titleJobs.every(
      (titleJob) =>
        titleJob.status === "moved" ||
        titleJob.status === "skipped" ||
        titleJob.status === "review" ||
        titleJob.status === "conflict"
    )
      ? "completed"
      : "failed";
    await this.setJobStatus(manifest, finalStatus);
    await this.updateSeriesProgressFromManifest(manifest);
  }

  private async moveToReview(
    manifest: JobManifest,
    sourcePath: string,
    reason: string
  ): Promise<string | null> {
    if (!(await fileExists(sourcePath))) {
      return null;
    }
    const targetPath = path.join(manifest.reviewDir, path.basename(sourcePath));
    await moveFile(sourcePath, targetPath);
    await writeTextFile(`${targetPath}.reason.txt`, `${reason}\n`);
    return targetPath;
  }

  private async runCommandForSummary(command: string, args: string[]): Promise<string> {
    const result = await this.deps.runner.run(command, args);
    if (result.exitCode !== 0) {
      throw new Error(
        `Smoke test command failed: ${[command, ...args].join(" ")}\n${result.stderr || result.stdout}`
      );
    }
    return (result.stdout || result.stderr).split(/\r?\n/).find((line) => line.trim()) ?? "";
  }

  private async setJobStatus(
    manifest: JobManifest,
    nextStatus: JobManifest["status"],
    forceEmit = false
  ): Promise<void> {
    if (manifest.status !== nextStatus) {
      manifest.status = nextStatus;
      await this.deps.manifestStore.save(manifest);
      await this.deps.webhooks.emitJobEvent(this.jobStatusToWebhookEvent(nextStatus), manifest);
      return;
    }

    await this.deps.manifestStore.save(manifest);
    if (forceEmit) {
      await this.deps.webhooks.emitJobEvent(this.jobStatusToWebhookEvent(nextStatus), manifest);
    }
  }

  private async setTitleJobStatus(
    manifest: JobManifest,
    titleJob: TitleJobRecord,
    nextStatus: TitleJobRecord["status"]
  ): Promise<void> {
    titleJob.status = nextStatus;
    await this.deps.manifestStore.save(manifest);
    const eventName = this.titleStatusToWebhookEvent(nextStatus);
    if (eventName) {
      await this.deps.webhooks.emitTitleEvent(eventName, manifest, titleJob);
    }
  }

  private jobStatusToWebhookEvent(status: JobManifest["status"]) {
    switch (status) {
      case "disc_detected":
        return "job.disc_detected" as const;
      case "scanning":
        return "job.scanning" as const;
      case "ripping":
        return "job.ripping" as const;
      case "probing":
        return "job.probing" as const;
      case "matching":
        return "job.matching" as const;
      case "encoding":
        return "job.encoding" as const;
      case "moving":
        return "job.moving" as const;
      case "completed":
        return "job.completed" as const;
      case "failed":
        return "job.failed" as const;
      case "cleanup":
        return "job.completed" as const;
    }
  }

  private titleStatusToWebhookEvent(status: TitleJobRecord["status"]) {
    switch (status) {
      case "moved":
        return "title.moved" as const;
      case "skipped":
        return "title.skipped" as const;
      case "review":
        return "title.review" as const;
      case "conflict":
        return "title.conflict" as const;
      case "failed":
        return "title.failed" as const;
      default:
        return null;
    }
  }

  private filterEpisodesForSequentialDiscs(
    seasonEpisodes: SeasonEpisode[],
    lastCompletedEpisodeNumber?: number
  ): SeasonEpisode[] {
    if (!lastCompletedEpisodeNumber) {
      return seasonEpisodes;
    }

    const remainingEpisodes = seasonEpisodes.filter(
      (episode) => episode.episodeNumber > lastCompletedEpisodeNumber
    );

    if (!remainingEpisodes.length) {
      this.deps.logger.warn("Season progress indicates no remaining later episodes; using full season list", {
        lastCompletedEpisodeNumber
      });
      return seasonEpisodes;
    }

    this.deps.logger.info("Constraining candidate episodes using prior season progress", {
      lastCompletedEpisodeNumber,
      firstCandidateEpisodeNumber: remainingEpisodes[0]?.episodeNumber,
      candidateCount: remainingEpisodes.length
    });

    return remainingEpisodes;
  }

  private async updateSeriesProgressFromManifest(manifest: JobManifest): Promise<void> {
    const completedEpisodeNumbers = manifest.titleJobs
      .filter((titleJob) => titleJob.status === "moved")
      .flatMap((titleJob) => titleJob.episodeNumbers)
      .filter((episodeNumber) => Number.isFinite(episodeNumber));

    if (!completedEpisodeNumbers.length) {
      return;
    }

    const lastCompletedEpisodeNumber = Math.max(...completedEpisodeNumbers);
    const updated = await this.deps.seriesProgressStore.update({
      showTitle: manifest.showTitle,
      seasonNumber: manifest.seasonNumber,
      lastCompletedEpisodeNumber,
      lastJobId: manifest.jobId,
      lastDiscLabel: manifest.discLabel
    });

    this.deps.logger.info("Updated season progress from successful run", {
      lastCompletedEpisodeNumber: updated.lastCompletedEpisodeNumber,
      lastJobId: updated.lastJobId
    });
  }

  private async restoreRetryableSources(manifest: JobManifest): Promise<void> {
    const retryableStatuses = new Set(["review", "failed", "conflict"]);

    for (const titleJob of manifest.titleJobs) {
      if (!retryableStatuses.has(titleJob.status)) {
        continue;
      }

      const sourceTitle = manifest.rippedTitles.find((title) => title.titleIndex === titleJob.titleIndex);
      if (!sourceTitle) {
        continue;
      }

      const preferredPath = path.join(manifest.ripDir, path.basename(sourceTitle.filePath));
      const candidates = [
        titleJob.sourcePath,
        sourceTitle.filePath,
        path.join(manifest.reviewDir, path.basename(titleJob.sourcePath)),
        path.join(manifest.reviewDir, path.basename(sourceTitle.filePath))
      ];

      let existingPath: string | undefined;
      for (const candidate of candidates) {
        if (!candidate) {
          continue;
        }
        if (await fileExists(candidate)) {
          existingPath = candidate;
          break;
        }
      }

      if (!existingPath) {
        throw new Error(`Could not find source file for retry on title ${titleJob.titleIndex}`);
      }

      if (existingPath !== preferredPath) {
        await moveFile(existingPath, preferredPath);
      }

      titleJob.sourcePath = preferredPath;
      titleJob.encodedPath = undefined;
      titleJob.error = undefined;
      sourceTitle.filePath = preferredPath;
      sourceTitle.fileName = path.basename(preferredPath);
    }

    await this.deps.manifestStore.save(manifest);
  }

  private async rematchRetryableTitles(manifest: JobManifest): Promise<void> {
    const retryableStatuses = new Set(["review", "failed", "conflict"]);
    const retryableTitles = manifest.rippedTitles.filter((title) => {
      const titleJob = manifest.titleJobs.find((job) => job.titleIndex === title.titleIndex);
      return !titleJob || retryableStatuses.has(titleJob.status);
    });

    if (!retryableTitles.length) {
      return;
    }

    await this.setJobStatus(manifest, "matching");

    let seasonEpisodes: SeasonEpisode[] = [];
    let retryMappings: TitleMapping[];

    try {
      seasonEpisodes = await this.deps.tmdb.getSeasonEpisodes();
      const request = buildDiscMatchRequest(
        this.deps.config.series.showTitle,
        this.deps.config.series.seasonNumber,
        this.deps.config.matching.episodeMinSeconds,
        manifest.discLabel,
        retryableTitles,
        seasonEpisodes
      );
      const aiResponse = await this.deps.openai.matchDisc(request);
      retryMappings = validateAndNormalizeMappings(request, aiResponse);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      manifest.errors.push(`Retry matching fallback triggered: ${reason}`);
      retryMappings = retryableTitles.map((title) => ({
        titleIndex: title.titleIndex,
        classification: title.durationSeconds < this.deps.config.matching.episodeMinSeconds ? "extra" : "unmapped",
        episodeNumbers: [],
        reason
      }));
    }

    const retryMappingByTitle = new Map(retryMappings.map((mapping) => [mapping.titleIndex, mapping]));
    const preservedMappings = manifest.mappings.filter(
      (mapping) => !retryMappingByTitle.has(mapping.titleIndex)
    );
    manifest.mappings = [...preservedMappings, ...retryMappings];

    const episodeMap = buildEpisodeLookup(seasonEpisodes);
    const existingJobsByTitle = new Map(manifest.titleJobs.map((job) => [job.titleIndex, job]));

    manifest.titleJobs = manifest.rippedTitles.map((title) => {
      const existingJob = existingJobsByTitle.get(title.titleIndex);
      if (existingJob && !retryableStatuses.has(existingJob.status)) {
        return existingJob;
      }

      const mapping =
        retryMappingByTitle.get(title.titleIndex) ??
        ({
          titleIndex: title.titleIndex,
          classification: "unmapped",
          episodeNumbers: [],
          reason: "No valid mapping returned"
        } satisfies TitleMapping);

      return {
        titleIndex: title.titleIndex,
        sourcePath: title.filePath,
        finalPath:
          mapping.classification === "unmapped" || mapping.classification === "skip"
            ? undefined
            : buildDestinationPath(this.deps.config, manifest.discLabel, title, mapping, episodeMap),
        classification: mapping.classification,
        episodeNumbers: mapping.episodeNumbers,
        status: "pending",
        reason: mapping.reason
      } satisfies TitleJobRecord;
    });

    await this.deps.manifestStore.save(manifest);
  }
}
