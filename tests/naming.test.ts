import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildDestinationPath, buildEpisodeFileName, sanitizePathSegment } from "../src/naming/jellyfin";
import { createTestConfig } from "./helpers";

describe("jellyfin naming", () => {
  it("sanitizes segments and builds episode filenames", () => {
    expect(sanitizePathSegment('Show: "A/B"?')).toBe("Show A B");
    expect(buildEpisodeFileName("Example Show", 1, [1, 2], ["Pilot", "Second"])).toBe(
      "Example Show - S01E01-E02 - Pilot & Second.mkv"
    );
  });

  it("routes extras into the extras folder", () => {
    const config = createTestConfig("/tmp/example");
    const finalPath = buildDestinationPath(
      config,
      "DISC_1",
      {
        titleIndex: 3,
        sourceOrder: 3,
        filePath: "/tmp/title3.mkv",
        fileName: "title3.mkv",
        sizeBytes: 10,
        durationSeconds: 300
      },
      {
        titleIndex: 3,
        classification: "extra",
        episodeNumbers: [],
        reason: "Bonus feature"
      },
      new Map()
    );

    expect(finalPath).toBe(
      path.join(
        config.paths.libraryRoot,
        "Example Show",
        "Season 01",
        "Extras",
        "Example Show - DISC_1 - Title 03 - 00h05m00s.mkv"
      )
    );
  });
});
