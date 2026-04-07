import { z } from "zod";
import type {
  DiscMatchRequest,
  DiscMatchResponse,
  PipelineLogger,
  ResolvedConfig
} from "../types";

const titleMappingSchema = z.object({
  title_index: z.number().int().positive(),
  classification: z.enum(["episode", "multi_episode", "extra", "unmapped"]),
  season_number: z.number().int().positive().nullable(),
  episode_numbers: z.array(z.number().int().positive()).default([]),
  reason: z.string().min(1)
});

const discMatchResponseSchema = z.object({
  disc_label: z.string().min(1),
  titles: z.array(titleMappingSchema)
});

function buildPrompt(request: DiscMatchRequest): string {
  const titles = request.rippedTitles.map((title) => ({
    title_index: title.titleIndex,
    source_order: title.sourceOrder,
    file_name: title.fileName,
    duration_seconds: Math.round(title.durationSeconds)
  }));

  const episodes = request.candidateEpisodes.map((episode) => ({
    season_number: episode.seasonNumber,
    episode_number: episode.episodeNumber,
    name: episode.name,
    runtime_minutes: episode.runtimeMinutes ?? null,
    air_date: episode.airDate ?? null
  }));

  return [
    "Map ripped disc titles to TV season episodes.",
    "Return only JSON that matches the requested schema.",
    `Show: ${request.showTitle}`,
    `Season: ${request.seasonNumber}`,
    `Disc label: ${request.discLabel}`,
    `Episode minimum seconds: ${request.episodeMinSeconds}`,
    "Classification rules:",
    "- Use `extra` for non-episode or bonus material.",
    "- Use `unmapped` if there is not enough evidence.",
    "- Use `multi_episode` only for consecutive episode numbers in one file.",
    "",
    `Ripped titles:\n${JSON.stringify(titles, null, 2)}`,
    "",
    `Candidate episodes:\n${JSON.stringify(episodes, null, 2)}`
  ].join("\n");
}

function extractMessageContent(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    throw new Error("OpenAI response was not an object");
  }

  const root = payload as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };

  const content = root.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI response did not include message content");
  }

  return content;
}

export class OpenAiMatcher {
  constructor(
    private readonly config: ResolvedConfig,
    private readonly logger: PipelineLogger
  ) {}

  async matchDisc(request: DiscMatchRequest): Promise<DiscMatchResponse> {
    this.logger.info("Requesting OpenAI disc match", {
      discLabel: request.discLabel,
      titleCount: request.rippedTitles.length
    });

    const response = await fetch(`${this.config.openai.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.openai.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.config.openai.model,
        messages: [
          {
            role: "system",
            content:
              "You map ripped optical-disc titles to TV season episodes. Return only valid JSON."
          },
          {
            role: "user",
            content: buildPrompt(request)
          }
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "disc_match_response",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["disc_label", "titles"],
              properties: {
                disc_label: { type: "string" },
                titles: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: [
                      "title_index",
                      "classification",
                      "season_number",
                      "episode_numbers",
                      "reason"
                    ],
                    properties: {
                      title_index: { type: "integer" },
                      classification: {
                        type: "string",
                        enum: ["episode", "multi_episode", "extra", "unmapped"]
                      },
                      season_number: {
                        type: ["integer", "null"]
                      },
                      episode_numbers: {
                        type: "array",
                        items: { type: "integer" }
                      },
                      reason: { type: "string" }
                    }
                  }
                }
              }
            }
          }
        }
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI request failed (${response.status}): ${await response.text()}`);
    }

    const parsedBody = (await response.json()) as unknown;
    const content = extractMessageContent(parsedBody);
    const parsedContent = JSON.parse(content) as unknown;
    const parsed = discMatchResponseSchema.parse(parsedContent);

    return {
      discLabel: parsed.disc_label,
      titles: parsed.titles.map((title) => ({
        titleIndex: title.title_index,
        classification: title.classification,
        seasonNumber: title.season_number ?? undefined,
        episodeNumbers: title.episode_numbers,
        reason: title.reason
      }))
    };
  }
}
