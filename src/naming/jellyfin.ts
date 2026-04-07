import path from "node:path";
import type { ResolvedConfig, RippedTitle, SeasonEpisode, TitleMapping } from "../types";

export function sanitizePathSegment(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatSeasonNumber(seasonNumber: number): string {
  return `Season ${String(seasonNumber).padStart(2, "0")}`;
}

function formatDuration(durationSeconds: number): string {
  const hours = Math.floor(durationSeconds / 3600);
  const minutes = Math.floor((durationSeconds % 3600) / 60);
  const seconds = Math.floor(durationSeconds % 60);
  return `${String(hours).padStart(2, "0")}h${String(minutes).padStart(2, "0")}m${String(seconds).padStart(2, "0")}s`;
}

export function buildEpisodeFileName(
  showTitle: string,
  seasonNumber: number,
  episodeNumbers: number[],
  episodeTitles: string[]
): string {
  const show = sanitizePathSegment(showTitle);
  const seasonCode = `S${String(seasonNumber).padStart(2, "0")}`;
  const episodeCode =
    episodeNumbers.length === 1
      ? `E${String(episodeNumbers[0]).padStart(2, "0")}`
      : `E${String(episodeNumbers[0]).padStart(2, "0")}-E${String(episodeNumbers.at(-1) ?? episodeNumbers[0]).padStart(2, "0")}`;
  const episodeTitle = sanitizePathSegment(episodeTitles.join(" & "));
  return `${show} - ${seasonCode}${episodeCode} - ${episodeTitle}.mkv`;
}

export function buildDestinationPath(
  config: ResolvedConfig,
  discLabel: string,
  title: RippedTitle,
  mapping: TitleMapping,
  episodeMap: Map<number, SeasonEpisode>
): string {
  const showDir = sanitizePathSegment(config.series.showTitle);
  const seasonDir = formatSeasonNumber(config.series.seasonNumber);
  const baseDir = path.join(config.paths.libraryRoot, showDir, seasonDir);

  if (mapping.classification === "extra" || title.durationSeconds < config.matching.episodeMinSeconds) {
    const fileName = `${showDir} - ${sanitizePathSegment(discLabel)} - Title ${String(
      title.titleIndex
    ).padStart(2, "0")} - ${formatDuration(title.durationSeconds)}.mkv`;
    return path.join(baseDir, sanitizePathSegment(config.matching.extrasFolderName), fileName);
  }

  const episodeTitles = mapping.episodeNumbers.map((episodeNumber) => {
    const episode = episodeMap.get(episodeNumber);
    return episode?.name ?? `Episode ${episodeNumber}`;
  });

  return path.join(
    baseDir,
    buildEpisodeFileName(
      config.series.showTitle,
      config.series.seasonNumber,
      mapping.episodeNumbers,
      episodeTitles
    )
  );
}
