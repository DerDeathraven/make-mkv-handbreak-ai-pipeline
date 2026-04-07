import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SeriesProgressRecord } from "../types";
import { ensureDir } from "../utils/fs";

interface ProgressStateFile {
  series: Record<string, SeriesProgressRecord>;
}

function buildKey(showTitle: string, seasonNumber: number): string {
  return `${showTitle}::season-${seasonNumber}`;
}

export class SeriesProgressStore {
  constructor(private readonly workRoot: string) {}

  private get filePath(): string {
    return path.join(this.workRoot, "state", "series-progress.json");
  }

  private async loadState(): Promise<ProgressStateFile> {
    try {
      const content = await readFile(this.filePath, "utf8");
      return JSON.parse(content) as ProgressStateFile;
    } catch (error) {
      const failure = error as NodeJS.ErrnoException;
      if (failure.code === "ENOENT") {
        return { series: {} };
      }
      throw failure;
    }
  }

  private async saveState(state: ProgressStateFile): Promise<void> {
    await ensureDir(path.dirname(this.filePath));
    await writeFile(this.filePath, JSON.stringify(state, null, 2), "utf8");
  }

  async get(showTitle: string, seasonNumber: number): Promise<SeriesProgressRecord | null> {
    const state = await this.loadState();
    return state.series[buildKey(showTitle, seasonNumber)] ?? null;
  }

  async update(input: {
    showTitle: string;
    seasonNumber: number;
    lastCompletedEpisodeNumber: number;
    lastJobId: string;
    lastDiscLabel: string;
  }): Promise<SeriesProgressRecord> {
    const state = await this.loadState();
    const key = buildKey(input.showTitle, input.seasonNumber);
    const existing = state.series[key];
    const lastCompletedEpisodeNumber = Math.max(
      existing?.lastCompletedEpisodeNumber ?? 0,
      input.lastCompletedEpisodeNumber
    );

    const record: SeriesProgressRecord = {
      key,
      showTitle: input.showTitle,
      seasonNumber: input.seasonNumber,
      lastCompletedEpisodeNumber,
      lastUpdatedAt: new Date().toISOString(),
      lastJobId: input.lastJobId,
      lastDiscLabel: input.lastDiscLabel
    };

    state.series[key] = record;
    await this.saveState(state);
    return record;
  }
}
