import path from "node:path";
import { writeFile, mkdir, stat } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { PipelineService } from "../src/app/pipeline";
import { JobManifestStore } from "../src/jobs/manifest";
import { createTempDir, createTestConfig, noopLogger, removeTempDir } from "./helpers";

describe("PipelineService integration", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(removeTempDir));
  });

  function createService(rootDir: string, options?: {
    openAiError?: string;
    conflict?: boolean;
  }): PipelineService {
    const config = createTestConfig(rootDir);
    const manifestStore = new JobManifestStore(config.app.workRoot);

    const makeMkv = {
      async scanDisc() {
        return {
          discLabel: "DISC_1",
          rawOutput: "",
          titles: [{ titleId: 0, sourceOrder: 1, rawAttributes: {} }]
        };
      },
      async ripTitles(outputDir: string) {
        await mkdir(outputDir, { recursive: true });
        await writeFile(path.join(outputDir, "title_t00.mkv"), "source");
      },
      async buildRippedTitleList(ripDir: string) {
        return [
          {
            titleIndex: 1,
            sourceOrder: 1,
            filePath: path.join(ripDir, "title_t00.mkv"),
            fileName: "title_t00.mkv",
            sizeBytes: 6,
            makeMkvTitleId: 0,
            reportedDurationSeconds: 1500
          }
        ];
      }
    };

    const ffprobe = {
      async probe() {
        return { durationSeconds: 1500 };
      }
    };

    const tmdb = {
      async getSeasonEpisodes() {
        return [{ seasonNumber: 1, episodeNumber: 1, name: "Pilot", runtimeMinutes: 25 }];
      }
    };

    const openai = {
      async matchDisc() {
        if (options?.openAiError) {
          throw new Error(options.openAiError);
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
      buildEncodedPath(encodedDir: string) {
        return path.join(encodedDir, "title_t00.mkv");
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
      manifestStore
    });
  }

  it("moves encoded output to Jellyfin and deletes the source rip after success", async () => {
    const tempDir = await createTempDir("pipeline-success-");
    tempDirs.push(tempDir);
    const service = createService(tempDir);

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
    const service = createService(tempDir, { openAiError: "timeout" });

    const manifest = await service.processDetectedDisc({ present: true, rawOutput: "" });

    expect(manifest.titleJobs[0].status).toBe("review");
    expect(await stat(path.join(manifest.reviewDir, "title_t00.mkv"))).toBeDefined();
    expect(manifest.status).toBe("completed");
  });

  it("can retry a reviewed job after the matching problem is fixed", async () => {
    const tempDir = await createTempDir("pipeline-retry-review-");
    tempDirs.push(tempDir);

    const failingService = createService(tempDir, { openAiError: "timeout" });
    const failedManifest = await failingService.processDetectedDisc({ present: true, rawOutput: "" });

    expect(failedManifest.titleJobs[0].status).toBe("review");
    expect(await stat(path.join(failedManifest.reviewDir, "title_t00.mkv"))).toBeDefined();

    const retryService = createService(tempDir);
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

    const service = createService(tempDir, { conflict: true });
    const manifest = await service.processDetectedDisc({ present: true, rawOutput: "" });

    expect(manifest.titleJobs[0].status).toBe("conflict");
    expect(await stat(path.join(manifest.reviewDir, "conflicts", "title_t00.mkv"))).toBeDefined();
    expect(await stat(manifest.titleJobs[0].sourcePath)).toBeDefined();
  });
});
