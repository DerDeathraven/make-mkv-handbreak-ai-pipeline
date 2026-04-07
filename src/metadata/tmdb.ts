import type { PipelineLogger, ResolvedConfig, SeasonEpisode } from "../types";

interface TmdbSearchResponse {
  results?: Array<{
    id: number;
    name: string;
  }>;
}

interface TmdbTvDetailsResponse {
  episode_run_time?: number[];
}

interface TmdbSeasonResponse {
  episodes?: Array<{
    episode_number: number;
    name: string;
    runtime?: number | null;
    air_date?: string;
  }>;
}

async function fetchJson<T>(url: URL, bearerToken: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`TMDb request failed (${response.status}): ${await response.text()}`);
  }

  return (await response.json()) as T;
}

function buildApiUrl(baseUrl: string, route: string): URL {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(route.replace(/^\//, ""), normalizedBase);
}

export class TmdbClient {
  constructor(
    private readonly config: ResolvedConfig,
    private readonly logger: PipelineLogger
  ) {}

  async getSeasonEpisodes(): Promise<SeasonEpisode[]> {
    const searchUrl = buildApiUrl(this.config.tmdb.baseUrl, "search/tv");
    searchUrl.searchParams.set("query", this.config.series.showTitle);
    searchUrl.searchParams.set("language", this.config.series.language);
    this.logger.info("Searching TMDb for series", {
      showTitle: this.config.series.showTitle
    });
    const searchResponse = await fetchJson<TmdbSearchResponse>(searchUrl, this.config.tmdb.apiKey);
    const series = searchResponse.results?.[0];
    if (!series) {
      throw new Error(`TMDb series not found for "${this.config.series.showTitle}"`);
    }

    const detailsUrl = buildApiUrl(this.config.tmdb.baseUrl, `tv/${series.id}`);
    detailsUrl.searchParams.set("language", this.config.series.language);
    const details = await fetchJson<TmdbTvDetailsResponse>(detailsUrl, this.config.tmdb.apiKey);
    const fallbackRuntimeMinutes = details.episode_run_time?.[0];

    const seasonUrl = buildApiUrl(
      this.config.tmdb.baseUrl,
      `tv/${series.id}/season/${this.config.series.seasonNumber}`
    );
    seasonUrl.searchParams.set("language", this.config.series.language);
    const seasonResponse = await fetchJson<TmdbSeasonResponse>(seasonUrl, this.config.tmdb.apiKey);

    return (seasonResponse.episodes ?? []).map((episode) => ({
      seasonNumber: this.config.series.seasonNumber,
      episodeNumber: episode.episode_number,
      name: episode.name,
      runtimeMinutes: episode.runtime ?? fallbackRuntimeMinutes,
      airDate: episode.air_date
    }));
  }
}
