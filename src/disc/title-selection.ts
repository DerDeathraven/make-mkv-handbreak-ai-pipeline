import type { DiscTitleScan, SeasonEpisode } from "../types";

export interface RipSelectionResult {
  selectedTitles: DiscTitleScan[];
  skippedTitles: Array<{
    titleId: number;
    durationSeconds?: number;
    reason: string;
  }>;
  baselineRuntimeSeconds?: number;
  skipThresholdSeconds?: number;
}

function median(values: number[]): number | undefined {
  if (!values.length) {
    return undefined;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function getBaselineRuntimeSeconds(
  candidateEpisodes: SeasonEpisode[],
  scanTitles: DiscTitleScan[],
  episodeMinSeconds: number
): number | undefined {
  const tmdbRuntimeSeconds = candidateEpisodes
    .map((episode) => episode.runtimeMinutes)
    .filter((runtimeMinutes): runtimeMinutes is number => typeof runtimeMinutes === "number" && runtimeMinutes > 0)
    .map((runtimeMinutes) => runtimeMinutes * 60);

  if (tmdbRuntimeSeconds.length) {
    return median(tmdbRuntimeSeconds);
  }

  const scanDurations = scanTitles
    .map((title) => title.reportedDurationSeconds)
    .filter((duration): duration is number => typeof duration === "number" && duration >= episodeMinSeconds);

  return median(scanDurations);
}

export function selectTitlesForRip(
  scanTitles: DiscTitleScan[],
  candidateEpisodes: SeasonEpisode[],
  episodeMinSeconds: number,
  stitchedTitleMultiplier: number
): RipSelectionResult {
  const fullLengthTitles = scanTitles.filter(
    (title) =>
      typeof title.reportedDurationSeconds === "number" &&
      title.reportedDurationSeconds >= episodeMinSeconds
  );

  if (fullLengthTitles.length <= 1) {
    return {
      selectedTitles: scanTitles,
      skippedTitles: []
    };
  }

  const baselineRuntimeSeconds = getBaselineRuntimeSeconds(
    candidateEpisodes,
    scanTitles,
    episodeMinSeconds
  );

  if (!baselineRuntimeSeconds || baselineRuntimeSeconds <= 0) {
    return {
      selectedTitles: scanTitles,
      skippedTitles: []
    };
  }

  const skipThresholdSeconds = baselineRuntimeSeconds * stitchedTitleMultiplier;
  const selectedTitles: DiscTitleScan[] = [];
  const skippedTitles: RipSelectionResult["skippedTitles"] = [];

  for (const title of scanTitles) {
    const durationSeconds = title.reportedDurationSeconds;
    if (
      typeof durationSeconds === "number" &&
      durationSeconds >= episodeMinSeconds &&
      durationSeconds > skipThresholdSeconds
    ) {
      skippedTitles.push({
        titleId: title.titleId,
        durationSeconds,
        reason: "Detected as stitched multi-episode compilation title"
      });
      continue;
    }

    selectedTitles.push(title);
  }

  const remainingFullLengthTitles = selectedTitles.filter(
    (title) =>
      typeof title.reportedDurationSeconds === "number" &&
      title.reportedDurationSeconds >= episodeMinSeconds
  );

  if (!remainingFullLengthTitles.length) {
    return {
      selectedTitles: scanTitles,
      skippedTitles: []
    };
  }

  return {
    selectedTitles,
    skippedTitles,
    baselineRuntimeSeconds,
    skipThresholdSeconds
  };
}
