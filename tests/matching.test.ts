import { describe, expect, it } from "vitest";
import { buildDiscMatchRequest, validateAndNormalizeMappings } from "../src/matching/mapper";

describe("mapping validation", () => {
  it("forces short titles to extras and rejects duplicate single-episode assignments", () => {
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
          durationSeconds: 1500
        },
        {
          titleIndex: 3,
          sourceOrder: 3,
          filePath: "/tmp/3.mkv",
          fileName: "3.mkv",
          sizeBytes: 1,
          durationSeconds: 300
        }
      ],
      [
        { seasonNumber: 1, episodeNumber: 1, name: "Pilot" },
        { seasonNumber: 1, episodeNumber: 2, name: "Second" }
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
          classification: "episode",
          episodeNumbers: [1],
          reason: "duplicate"
        },
        {
          titleIndex: 3,
          classification: "episode",
          episodeNumbers: [2],
          reason: "too short"
        }
      ]
    });

    expect(mappings[0]).toMatchObject({ classification: "episode", episodeNumbers: [1] });
    expect(mappings[1]).toMatchObject({ classification: "unmapped", episodeNumbers: [] });
    expect(mappings[2]).toMatchObject({ classification: "extra", episodeNumbers: [] });
  });
});
