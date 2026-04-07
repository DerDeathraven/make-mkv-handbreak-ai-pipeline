import type {
  DiscMatchRequest,
  DiscMatchResponse,
  RippedTitle,
  SeasonEpisode,
  TitleMapping
} from "../types";

export function validateAndNormalizeMappings(
  request: DiscMatchRequest,
  response: DiscMatchResponse
): TitleMapping[] {
  const validEpisodeNumbers = new Set(
    request.candidateEpisodes.map((episode) => episode.episodeNumber)
  );
  const sourceTitleIndexes = new Set(request.rippedTitles.map((title) => title.titleIndex));
  const usedSingleEpisodes = new Set<number>();
  const byTitleIndex = new Map<number, TitleMapping>();

  for (const mapping of response.titles) {
    if (!sourceTitleIndexes.has(mapping.titleIndex)) {
      continue;
    }

    if (mapping.classification === "extra" || mapping.classification === "unmapped") {
      byTitleIndex.set(mapping.titleIndex, {
        ...mapping,
        episodeNumbers: []
      });
      continue;
    }

    if (!mapping.episodeNumbers.length) {
      byTitleIndex.set(mapping.titleIndex, {
        titleIndex: mapping.titleIndex,
        classification: "unmapped",
        episodeNumbers: [],
        reason: "AI response did not include episode numbers"
      });
      continue;
    }

    const invalidEpisode = mapping.episodeNumbers.find((episodeNumber) => !validEpisodeNumbers.has(episodeNumber));
    if (invalidEpisode) {
      byTitleIndex.set(mapping.titleIndex, {
        titleIndex: mapping.titleIndex,
        classification: "unmapped",
        episodeNumbers: [],
        reason: `Invalid episode number ${invalidEpisode}`
      });
      continue;
    }

    if (mapping.classification === "multi_episode") {
      const sorted = [...mapping.episodeNumbers].sort((left, right) => left - right);
      const isConsecutive = sorted.every((episodeNumber, index) => {
        if (index === 0) {
          return true;
        }
        return episodeNumber === sorted[index - 1] + 1;
      });
      if (!isConsecutive) {
        byTitleIndex.set(mapping.titleIndex, {
          titleIndex: mapping.titleIndex,
          classification: "unmapped",
          episodeNumbers: [],
          reason: "Multi-episode mapping was not consecutive"
        });
        continue;
      }
      byTitleIndex.set(mapping.titleIndex, {
        ...mapping,
        episodeNumbers: sorted
      });
      continue;
    }

    const episodeNumber = mapping.episodeNumbers[0];
    if (usedSingleEpisodes.has(episodeNumber)) {
      byTitleIndex.set(mapping.titleIndex, {
        titleIndex: mapping.titleIndex,
        classification: "unmapped",
        episodeNumbers: [],
        reason: `Duplicate single-episode mapping for episode ${episodeNumber}`
      });
      continue;
    }

    usedSingleEpisodes.add(episodeNumber);
    byTitleIndex.set(mapping.titleIndex, {
      ...mapping,
      episodeNumbers: [episodeNumber]
    });
  }

  return request.rippedTitles.map((title) => {
    if (title.durationSeconds < request.episodeMinSeconds) {
      return {
        titleIndex: title.titleIndex,
        classification: "extra",
        episodeNumbers: [],
        reason: "Runtime below episode minimum threshold"
      };
    }

    return (
      byTitleIndex.get(title.titleIndex) ?? {
        titleIndex: title.titleIndex,
        classification: "unmapped",
        episodeNumbers: [],
        reason: "No valid mapping returned"
      }
    );
  });
}

export function buildEpisodeLookup(episodes: SeasonEpisode[]): Map<number, SeasonEpisode> {
  return new Map(episodes.map((episode) => [episode.episodeNumber, episode]));
}

export function buildDiscMatchRequest(
  showTitle: string,
  seasonNumber: number,
  episodeMinSeconds: number,
  discLabel: string,
  rippedTitles: RippedTitle[],
  candidateEpisodes: SeasonEpisode[],
  lastCompletedEpisodeNumber?: number
): DiscMatchRequest {
  return {
    showTitle,
    seasonNumber,
    discLabel,
    episodeMinSeconds,
    lastCompletedEpisodeNumber,
    rippedTitles,
    candidateEpisodes
  };
}
