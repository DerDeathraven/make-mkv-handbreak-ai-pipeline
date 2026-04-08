import { describe, expect, it } from "vitest";
import { buildPrompt } from "../src/ai/openai";

describe("buildPrompt", () => {
  it("includes stitched-title guidance and following-title runtime context", () => {
    const prompt = buildPrompt({
      showTitle: "The Librarians",
      seasonNumber: 1,
      discLabel: "DISC_1",
      episodeMinSeconds: 700,
      lastCompletedEpisodeNumber: undefined,
      rippedTitles: [
        {
          titleIndex: 1,
          sourceOrder: 1,
          filePath: "/tmp/B1_t03.mkv",
          fileName: "B1_t03.mkv",
          sizeBytes: 1,
          durationSeconds: 7690.64
        },
        {
          titleIndex: 2,
          sourceOrder: 2,
          filePath: "/tmp/C1_t00.mkv",
          fileName: "C1_t00.mkv",
          sizeBytes: 1,
          durationSeconds: 2684.64
        },
        {
          titleIndex: 3,
          sourceOrder: 3,
          filePath: "/tmp/C2_t01.mkv",
          fileName: "C2_t01.mkv",
          sizeBytes: 1,
          durationSeconds: 2422.92
        }
      ],
      candidateEpisodes: [
        { seasonNumber: 1, episodeNumber: 1, name: "Ep1", runtimeMinutes: 44 },
        { seasonNumber: 1, episodeNumber: 2, name: "Ep2", runtimeMinutes: 41 },
        { seasonNumber: 1, episodeNumber: 3, name: "Ep3", runtimeMinutes: 40 }
      ]
    });

    expect(prompt).toContain("Watch for stitched-together files");
    expect(prompt).toContain('"following_title_durations_seconds": [\n      2685,\n      2423\n    ]');
    expect(prompt).toContain('"next_title_duration_seconds": 2685');
  });
});
