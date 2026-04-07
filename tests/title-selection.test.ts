import { describe, expect, it } from "vitest";
import { selectTitlesForRip } from "../src/disc/title-selection";

describe("selectTitlesForRip", () => {
  it("skips a stitched compilation title before ripping", () => {
    const result = selectTitlesForRip(
      [
        { titleId: 0, sourceOrder: 1, reportedDurationSeconds: 1320, rawAttributes: {} },
        { titleId: 1, sourceOrder: 2, reportedDurationSeconds: 1330, rawAttributes: {} },
        { titleId: 2, sourceOrder: 3, reportedDurationSeconds: 1310, rawAttributes: {} },
        { titleId: 3, sourceOrder: 4, reportedDurationSeconds: 5400, rawAttributes: {} }
      ],
      [
        { seasonNumber: 1, episodeNumber: 1, name: "Ep1", runtimeMinutes: 22 },
        { seasonNumber: 1, episodeNumber: 2, name: "Ep2", runtimeMinutes: 22 },
        { seasonNumber: 1, episodeNumber: 3, name: "Ep3", runtimeMinutes: 22 }
      ],
      900,
      2.5
    );

    expect(result.selectedTitles.map((title) => title.titleId)).toEqual([0, 1, 2]);
    expect(result.skippedTitles).toEqual([
      {
        titleId: 3,
        durationSeconds: 5400,
        reason: "Detected as stitched multi-episode compilation title"
      }
    ]);
  });

  it("keeps a legitimate two-part title under the threshold", () => {
    const result = selectTitlesForRip(
      [
        { titleId: 0, sourceOrder: 1, reportedDurationSeconds: 2700, rawAttributes: {} },
        { titleId: 1, sourceOrder: 2, reportedDurationSeconds: 5400, rawAttributes: {} }
      ],
      [
        { seasonNumber: 1, episodeNumber: 1, name: "Ep1", runtimeMinutes: 45 },
        { seasonNumber: 1, episodeNumber: 2, name: "Ep2", runtimeMinutes: 45 }
      ],
      900,
      2.5
    );

    expect(result.selectedTitles.map((title) => title.titleId)).toEqual([0, 1]);
    expect(result.skippedTitles).toEqual([]);
  });
});
