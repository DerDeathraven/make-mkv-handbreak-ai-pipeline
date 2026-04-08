import { describe, expect, it } from "vitest";
import { buildDiscMatchRequest, validateAndNormalizeMappings } from "../src/matching/mapper";

describe("mapping validation", () => {
  it("forces short titles to extras, filters multi-episode stitched titles, and rejects duplicate single-episode assignments", () => {
    const request = buildDiscMatchRequest(
      "Show",
      1,
      900,
      "DISC",
      [
        {
          titleIndex: 1,
          sourceOrder: 1,
          filePath: "/tmp/1.mkv",
          fileName: "1.mkv",
          sizeBytes: 1,
          durationSeconds: 1500
        },
        {
          titleIndex: 2,
          sourceOrder: 2,
          filePath: "/tmp/2.mkv",
          fileName: "2.mkv",
          sizeBytes: 1,
          durationSeconds: 3000
        },
        {
          titleIndex: 3,
          sourceOrder: 3,
          filePath: "/tmp/3.mkv",
          fileName: "3.mkv",
          sizeBytes: 1,
          durationSeconds: 1500
        },
        {
          titleIndex: 4,
          sourceOrder: 4,
          filePath: "/tmp/4.mkv",
          fileName: "4.mkv",
          sizeBytes: 1,
          durationSeconds: 300
        }
      ],
      [
        { seasonNumber: 1, episodeNumber: 1, name: "Pilot" },
        { seasonNumber: 1, episodeNumber: 2, name: "Second" },
        { seasonNumber: 1, episodeNumber: 3, name: "Third" }
      ]
    );

    const mappings = validateAndNormalizeMappings(request, {
      discLabel: "DISC",
      titles: [
        {
          titleIndex: 1,
          classification: "episode",
          episodeNumbers: [1],
          reason: "match"
        },
        {
          titleIndex: 2,
          classification: "multi_episode",
          episodeNumbers: [1, 2, 3],
          reason: "stitched giant title"
        },
        {
          titleIndex: 3,
          classification: "episode",
          episodeNumbers: [1],
          reason: "duplicate"
        },
        {
          titleIndex: 4,
          classification: "episode",
          episodeNumbers: [2],
          reason: "too short"
        }
      ]
    });

    expect(mappings[0]).toMatchObject({ classification: "episode", episodeNumbers: [1] });
    expect(mappings[1]).toMatchObject({ classification: "skip", episodeNumbers: [1, 2, 3] });
    expect(mappings[2]).toMatchObject({ classification: "unmapped", episodeNumbers: [] });
    expect(mappings[3]).toMatchObject({ classification: "extra", episodeNumbers: [] });
  });

  it("keeps legitimate multi-episode files when they are not the sum of the other ripped titles", () => {
    const request = buildDiscMatchRequest(
      "Show",
      1,
      900,
      "DISC",
      [
        {
          titleIndex: 1,
          sourceOrder: 1,
          filePath: "/tmp/1.mkv",
          fileName: "1.mkv",
          sizeBytes: 1,
          durationSeconds: 2200
        },
        {
          titleIndex: 2,
          sourceOrder: 2,
          filePath: "/tmp/2.mkv",
          fileName: "2.mkv",
          sizeBytes: 1,
          durationSeconds: 1500
        },
        {
          titleIndex: 3,
          sourceOrder: 3,
          filePath: "/tmp/3.mkv",
          fileName: "3.mkv",
          sizeBytes: 1,
          durationSeconds: 1600
        }
      ],
      [
        { seasonNumber: 1, episodeNumber: 1, name: "Pilot" },
        { seasonNumber: 1, episodeNumber: 2, name: "Second" },
        { seasonNumber: 1, episodeNumber: 3, name: "Third" }
      ]
    );

    const mappings = validateAndNormalizeMappings(request, {
      discLabel: "DISC",
      titles: [
        {
          titleIndex: 1,
          classification: "multi_episode",
          episodeNumbers: [1, 2],
          reason: "real two-parter"
        },
        {
          titleIndex: 2,
          classification: "episode",
          episodeNumbers: [3],
          reason: "single"
        }
      ]
    });

    expect(mappings[0]).toMatchObject({ classification: "multi_episode", episodeNumbers: [1, 2] });
    expect(mappings[1]).toMatchObject({ classification: "episode", episodeNumbers: [3] });
  });
});
