import path from "node:path";
import { writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/schema";
import { createTempDir, removeTempDir } from "./helpers";

describe("loadConfig", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(removeTempDir));
  });

  it("resolves relative paths and environment-backed secrets", async () => {
    const tempDir = await createTempDir("pipeline-config-");
    tempDirs.push(tempDir);
    process.env.OPENAI_API_KEY = "openai-from-env";
    process.env.TMDB_API_KEY = "tmdb-from-env";
    const configPath = path.join(tempDir, "config.yaml");
    await writeFile(
      configPath,
      [
        "disc:",
        '  drive_selector: "disc:0"',
        "series:",
        '  show_title: "Show"',
        "  season_number: 1",
        "openai:",
        '  api_key: "env:OPENAI_API_KEY"',
        "tmdb:",
        '  api_key: "env:TMDB_API_KEY"',
        "makemkv:",
        '  binary_path: "./makemkvcon"',
        "handbrake:",
        '  binary_path: "./HandBrakeCLI"',
        '  preset_name: "Fast 1080p30"',
        "ffprobe:",
        '  binary_path: "./ffprobe"',
        "paths:",
        '  library_root: "./library"'
      ].join("\n"),
      "utf8"
    );

    const config = await loadConfig(configPath);

    expect(config.openai.apiKey).toBe("openai-from-env");
    expect(config.tmdb.apiKey).toBe("tmdb-from-env");
    expect(config.paths.libraryRoot).toBe(path.join(tempDir, "library"));
    expect(config.makemkv.binaryPath).toBe(path.join(tempDir, "makemkvcon"));
  });

  it("accepts valid webhook event keys", async () => {
    const tempDir = await createTempDir("pipeline-config-webhooks-valid-");
    tempDirs.push(tempDir);
    process.env.OPENAI_API_KEY = "openai-from-env";
    process.env.TMDB_API_KEY = "tmdb-from-env";
    const configPath = path.join(tempDir, "config.yaml");
    await writeFile(
      configPath,
      [
        "disc:",
        '  drive_selector: "disc:0"',
        "series:",
        '  show_title: "Show"',
        "  season_number: 1",
        "openai:",
        '  api_key: "env:OPENAI_API_KEY"',
        "tmdb:",
        '  api_key: "env:TMDB_API_KEY"',
        "makemkv:",
        '  binary_path: "./makemkvcon"',
        "handbrake:",
        '  binary_path: "./HandBrakeCLI"',
        '  preset_name: "Fast 1080p30"',
        "ffprobe:",
        '  binary_path: "./ffprobe"',
        "paths:",
        '  library_root: "./library"',
        "webhooks:",
        "  enabled: true",
        "  events:",
        '    job.ripping:',
        '      - url: "https://example.test/job-ripping"',
        '    title.moved:',
        '      - url: "https://example.test/title-moved"'
      ].join("\n"),
      "utf8"
    );

    const config = await loadConfig(configPath);

    expect(config.webhooks.enabled).toBe(true);
    expect(config.webhooks.events["job.ripping"]).toEqual([
      { url: "https://example.test/job-ripping" }
    ]);
    expect(config.webhooks.events["title.moved"]).toEqual([
      { url: "https://example.test/title-moved" }
    ]);
  });

  it("rejects unknown webhook event keys", async () => {
    const tempDir = await createTempDir("pipeline-config-webhooks-invalid-");
    tempDirs.push(tempDir);
    process.env.OPENAI_API_KEY = "openai-from-env";
    process.env.TMDB_API_KEY = "tmdb-from-env";
    const configPath = path.join(tempDir, "config.yaml");
    await writeFile(
      configPath,
      [
        "disc:",
        '  drive_selector: "disc:0"',
        "series:",
        '  show_title: "Show"',
        "  season_number: 1",
        "openai:",
        '  api_key: "env:OPENAI_API_KEY"',
        "tmdb:",
        '  api_key: "env:TMDB_API_KEY"',
        "makemkv:",
        '  binary_path: "./makemkvcon"',
        "handbrake:",
        '  binary_path: "./HandBrakeCLI"',
        '  preset_name: "Fast 1080p30"',
        "ffprobe:",
        '  binary_path: "./ffprobe"',
        "paths:",
        '  library_root: "./library"',
        "webhooks:",
        "  enabled: true",
        "  events:",
        '    job.nope:',
        '      - url: "https://example.test/job-nope"'
      ].join("\n"),
      "utf8"
    );

    await expect(loadConfig(configPath)).rejects.toThrow();
  });
});
