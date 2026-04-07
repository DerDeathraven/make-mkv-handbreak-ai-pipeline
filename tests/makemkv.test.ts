import { describe, expect, it } from "vitest";
import { parseDrutilStatus } from "../src/disc/monitor";
import { parseMakeMkvInfoOutput, parseMakeMkvProgressLine } from "../src/disc/makemkv";

describe("MakeMKV and drive parsing", () => {
  it("parses robot mode output", () => {
    const scan = parseMakeMkvInfoOutput(
      [
        'DRV:0,2,999,0,"Drive","DISC_ONE"',
        'TINFO:0,2,"Pilot"',
        'TINFO:0,9,"00:23:10"',
        'TINFO:1,2,"Second"',
        'TINFO:1,9,"00:23:05"'
      ].join("\n")
    );

    expect(scan.discLabel).toBe("DISC_ONE");
    expect(scan.titles).toHaveLength(2);
    expect(scan.titles[0].reportedDurationSeconds).toBe(1390);
  });

  it("treats no-media drutil output as empty", () => {
    expect(parseDrutilStatus("Vendor   Product           Rev \nNo Media Inserted")).toEqual({
      present: false,
      rawOutput: "Vendor   Product           Rev \nNo Media Inserted"
    });
  });

  it("parses MakeMKV progress lines", () => {
    expect(parseMakeMkvProgressLine('PRGC:5017,0,"Copying title 1 of 4"')).toEqual({
      type: "current_label",
      name: "Copying title 1 of 4"
    });

    expect(parseMakeMkvProgressLine("PRGV:250,600,1000")).toEqual({
      type: "progress",
      current: 250,
      total: 600,
      max: 1000,
      currentPercent: 25,
      totalPercent: 60
    });
  });
});
