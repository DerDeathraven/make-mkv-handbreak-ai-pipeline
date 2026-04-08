import path from "node:path";
import { chmod, writeFile, mkdir, stat } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { DiscMatchRequest, DiscMatchResponse, SeasonEpisode } from "../src/types";
import { PipelineService } from "../src/app/pipeline";
import { JobManifestStore } from "../src/jobs/manifest";
import { SeriesProgressStore } from "../src/state/series-progress";
import { createTempDir, createTestConfig, noopLogger, removeTempDir } from "./helpers";

describe("PipelineService integration", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(removeTempDir));
  });

  async function createService(rootDir: string, options?: {
    openAiError?: string;
    conflict?: boolean;
    seasonEpisodes?: SeasonEpisode[];
    matchDiscImpl?: (request: DiscMatchRequest) => Promise<DiscMatchResponse>;
    rippedTitles?: Array<{
      titleIndex: number;
      sourceOrder: number;
      fileName: string;
      durationSeconds: number;
      reportedDurationSeconds?: number;
      sizeBytes?: number;
      makeMkvTitleId?: number;
    }>;
  }): Promise<PipelineService> {
    const config = createTestConfig(rootDir);
    const binaryPaths = [
      config.makemkv.binaryPath,
      config.handbrake.binaryPath,
      config.ffprobe.binaryPath
    ];
    for (const binaryPath of binaryPaths) {
      await mkdir(path.dirname(binaryPath), { recursive: true });
      await writeFile(binaryPath, "#!/usr/bin/env bash\nexit 0\n");
      await chmod(binaryPath, 0o755);
    }
    const manifestStore = new JobManifestStore(config.app.workRoot);
    const rippedTitles = options?.rippedTitles ?? [
      {
        titleIndex: 1,
        sourceOrder: 1,
        fileName: "title_t00.mkv",
        durationSeconds: 1500,
        reportedDurationSeconds: 1500,
        sizeBytes: 6,
        makeMkvTitleId: 0
      }
    ];

    const makeMkv = {
      async scanDisc() {
        return {
          discLabel: "DISC_1",
          rawOutput: "",
          titles: rippedTitles.map((title, index) => ({
            titleId: title.makeMkvTitleId ?? index,
            sourceOrder: title.sourceOrder,
            reportedDurationSeconds: title.reportedDurationSeconds,
            rawAttributes: {}
          }))
        };
      },
      async ripTitles(outputDir: string) {
        await mkdir(outputDir, { recursive: true });
        for (const title of rippedTitles) {
          await writeFile(path.join(outputDir, title.fileName), "source");
        }
      },
      async buildRippedTitleList(ripDir: string) {
        return rippedTitles.map((title, index) => ({
          titleIndex: title.titleIndex,
          sourceOrder: title.sourceOrder,
          filePath: path.join(ripDir, title.fileName),
          fileName: title.fileName,
          sizeBytes: title.sizeBytes ?? 6,
          makeMkvTitleId: title.makeMkvTitleId ?? index,
          reportedDurationSeconds: title.reportedDurationSeconds
        }));
      }
    };

    const ffprobe = {
      async probe(filePath: string) {
        const matchedTitle = rippedTitles.find((title) => filePath.endsWith(title.fileName));
        return { durationSeconds: matchedTitle?.durationSeconds ?? 1500 };
      }
    };

    const tmdb = {
      async getSeasonEpisodes() {
        return options?.seasonEpisodes ?? [
          { seasonNumber: 1, episodeNumber: 1, name: "Pilot", runtimeMinutes: 25 }
        ];
      }
    };

    const openai = {
      async matchDisc(request: DiscMatchRequest) {
        if (options?.openAiError) {
          throw new Error(options.openAiError);
        }
        if (options?.matchDiscImpl) {
          return options.matchDiscImpl(request);
        }
        return {
          discLabel: "DISC_1",
          titles: [
            {
              titleIndex: 1,
              classification: "episode" as const,
              episodeNumbers: [1],
              reason: "match"
            }
          ]
        };
      }
    };

    const handbrake = {
      buildEncodedPath(encodedDir: string, sourcePath: string) {
        return path.join(encodedDir, path.basename(sourcePath));
      },
      async encode(_inputPath: string, outputPath: string) {
        await mkdir(path.dirname(outputPath), { recursive: true });
        await writeFile(outputPath, "encoded");
        return `${outputPath}.handbrake.log`;
      }
    };

    return new PipelineService({
      config,
      logger: noopLogger,
      runner: {
        async run(command: string) {
          if (command.endsWith("HandBrakeCLI")) {
            return { stdout: "HandBrake 1.11.1\n", stderr: "", exitCode: 0 };
          }
          if (command.endsWith("ffprobe")) {
            return { stdout: "ffprobe version 8.1\n", stderr: "", exitCode: 0 };
          }
          return { stdout: "", stderr: "", exitCode: 0 };
        }
      },
      monitor: {
        async poll() {
          return { present: false, rawOutput: "" };
        },
        async waitForStableInsertion() {
          return { present: true, rawOutput: "" };
        },
        async waitForRemoval() {
          return undefined;
        }
      },
      makeMkv: makeMkv as never,
      ffprobe: ffprobe as never,
      tmdb: tmdb as never,
      openai: openai as never,
      handbrake: handbrake as never,
      manifestStore,
      seriesProgressStore: new SeriesProgressStore(config.app.workRoot)
    });
  }

  it("moves encoded output to Jellyfin and deletes the source rip after success", async () => {
    const tempDir = await createTempDir("pipeline-success-");
    tempDirs.push(tempDir);
    const service = await createService(tempDir);

    const manifest = await service.processDetectedDisc({ present: true, rawOutput: "" });
    const finalPath = manifest.titleJobs[0].finalPath;
    const sourcePath = manifest.titleJobs[0].sourcePath;

    expect(finalPath).toBeDefined();
    expect(await stat(finalPath!)).toBeDefined();
    await expect(stat(sourcePath)).rejects.toThrow();
    expect(manifest.titleJobs[0].status).toBe("moved");
    expect(manifest.status).toBe("completed");
  });

  it("routes titles to review when OpenAI matching fails", async () => {
    const tempDir = await createTempDir("pipeline-openai-fail-");
    tempDirs.push(tempDir);
    const service = await createService(tempDir, { openAiError: "timeout" });

    const manifest = await service.processDetectedDisc({ present: true, rawOutput: "" });

    expect(manifest.titleJobs[0].status).toBe("review");
    expect(await stat(path.join(manifest.reviewDir, "title_t00.mkv"))).toBeDefined();
    expect(manifest.status).toBe("completed");
  });

  it("can retry a reviewed job after the matching problem is fixed", async () => {
    const tempDir = await createTempDir("pipeline-retry-review-");
    tempDirs.push(tempDir);

    const failingService = await createService(tempDir, { openAiError: "timeout" });
    const failedManifest = await failingService.processDetectedDisc({ present: true, rawOutput: "" });

    expect(failedManifest.titleJobs[0].status).toBe("review");
    expect(await stat(path.join(failedManifest.reviewDir, "title_t00.mkv"))).toBeDefined();

    const retryService = await createService(tempDir);
    const retriedManifest = await retryService.retryReviewJob(failedManifest.jobId);

    expect(retriedManifest.titleJobs[0].status).toBe("moved");
    expect(retriedManifest.status).toBe("completed");
    expect(await stat(retriedManifest.titleJobs[0].finalPath!)).toBeDefined();
  });

  it("does not overwrite existing destination files and preserves the source rip on conflict", async () => {
    const tempDir = await createTempDir("pipeline-conflict-");
    tempDirs.push(tempDir);
    const config = createTestConfig(tempDir);
    const existingDestination = path.join(
      config.paths.libraryRoot,
      "Example Show",
      "Season 01",
      "Example Show - S01E01 - Pilot.mkv"
    );
    await mkdir(path.dirname(existingDestination), { recursive: true });
    await writeFile(existingDestination, "existing");

    const service = await createService(tempDir, { conflict: true });
    const manifest = await service.processDetectedDisc({ present: true, rawOutput: "" });

    expect(manifest.titleJobs[0].status).toBe("conflict");
    expect(await stat(path.join(manifest.reviewDir, "conflicts", "title_t00.mkv"))).toBeDefined();
    expect(await stat(manifest.titleJobs[0].sourcePath)).toBeDefined();
  });

  it("runs a smoke test that writes a probe file into the destination library", async () => {
    const tempDir = await createTempDir("pipeline-smoke-test-");
    tempDirs.push(tempDir);
    const service = await createService(tempDir);

    const result = await service.runSmokeTest();

    expect(result.tmdbEpisodeCount).toBeGreaterThan(0);
    expect(result.openAiMappingCount).toBeGreaterThan(0);
    expect(await stat(result.destinationTestFile)).toBeDefined();
  });

  it("drops AI-detected stitched multi-episode titles instead of encoding them", async () => {
    const tempDir = await createTempDir("pipeline-skip-multiepisode-");
    tempDirs.push(tempDir);

    const service = await createService(tempDir, {
      seasonEpisodes: [
        { seasonNumber: 1, episodeNumber: 1, name: "Pilot", runtimeMinutes: 44 },
        { seasonNumber: 1, episodeNumber: 2, name: "Second", runtimeMinutes: 44 },
        { seasonNumber: 1, episodeNumber: 3, name: "Third", runtimeMinutes: 40 },
        { seasonNumber: 1, episodeNumber: 4, name: "Fourth", runtimeMinutes: 43 }
      ],
      rippedTitles: [
        {
          titleIndex: 1,
          sourceOrder: 1,
          fileName: "B1_t03.mkv",
          durationSeconds: 7690,
          reportedDurationSeconds: 7685,
          makeMkvTitleId: 3
        },
        {
          titleIndex: 2,
          sourceOrder: 2,
          fileName: "C1_t00.mkv",
          durationSeconds: 2685,
          reportedDurationSeconds: 2682,
          makeMkvTitleId: 0
        },
        {
          titleIndex: 3,
          sourceOrder: 3,
          fileName: "C2_t01.mkv",
          durationSeconds: 2423,
          reportedDurationSeconds: 2422,
          makeMkvTitleId: 1
        },
        {
          titleIndex: 4,
          sourceOrder: 4,
          fileName: "C3_t02.mkv",
          durationSeconds: 2583,
          reportedDurationSeconds: 2581,
          makeMkvTitleId: 2
        }
      ],
      matchDiscImpl: async (request) => ({
        discLabel: request.discLabel,
        titles: [
          {
            titleIndex: 1,
            classification: "multi_episode",
            seasonNumber: 1,
            episodeNumbers: [1, 2, 3, 4],
            reason: "giant stitched compilation"
          },
          {
            titleIndex: 2,
            classification: "episode",
            seasonNumber: 1,
            episodeNumbers: [2],
            reason: "single"
          },
          {
            titleIndex: 3,
            classification: "episode",
            seasonNumber: 1,
            episodeNumbers: [3],
            reason: "single"
          },
          {
            titleIndex: 4,
            classification: "episode",
            seasonNumber: 1,
            episodeNumbers: [4],
            reason: "single"
          }
        ]
      })
    });

    const manifest = await service.processDetectedDisc({ present: true, rawOutput: "" });

    expect(manifest.titleJobs[0].status).toBe("skipped");
    expect(manifest.titleJobs[0].classification).toBe("skip");
    await expect(stat(manifest.titleJobs[0].sourcePath)).rejects.toThrow();
    expect(manifest.titleJobs[0].finalPath).toBeUndefined();
  });

  it("carries over season progress so the next fresh disc starts after the last completed episode", async () => {
    const tempDir = await createTempDir("pipeline-sequential-progress-");
    tempDirs.push(tempDir);
    const seasonEpisodes: SeasonEpisode[] = [
      { seasonNumber: 1, episodeNumber: 1, name: "Pilot", runtimeMinutes: 25 },
      { seasonNumber: 1, episodeNumber: 2, name: "Second", runtimeMinutes: 25 },
      { seasonNumber: 1, episodeNumber: 3, name: "Third", runtimeMinutes: 25 }
    ];
    const seenCandidateEpisodes: number[][] = [];

    const firstService = await createService(tempDir, {
      seasonEpisodes,
      matchDiscImpl: async (request) => {
        seenCandidateEpisodes.push(request.candidateEpisodes.map((episode) => episode.episodeNumber));
        return {
          discLabel: request.discLabel,
          titles: [
            {
              titleIndex: 1,
              classification: "episode",
              seasonNumber: 1,
              episodeNumbers: [1],
              reason: "first disc"
            }
          ]
        };
      }
    });
    await firstService.processDetectedDisc({ present: true, rawOutput: "" });

    const secondService = await createService(tempDir, {
      seasonEpisodes,
      matchDiscImpl: async (request) => {
        seenCandidateEpisodes.push(request.candidateEpisodes.map((episode) => episode.episodeNumber));
        return {
          discLabel: request.discLabel,
          titles: [
            {
              titleIndex: 1,
              classification: "episode",
              seasonNumber: 1,
              episodeNumbers: [2],
              reason: "second disc"
            }
          ]
        };
      }
    });
    await secondService.processDetectedDisc({ present: true, rawOutput: "" });

    expect(seenCandidateEpisodes).toEqual([
      [1, 2, 3],
      [2, 3]
    ]);
  });
});
