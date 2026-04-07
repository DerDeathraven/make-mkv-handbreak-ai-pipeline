import { afterEach, describe, expect, it, vi } from "vitest";

const copyFileMock = vi.fn();
const mkdirMock = vi.fn();
const readdirMock = vi.fn();
const renameMock = vi.fn();
const statMock = vi.fn();
const unlinkMock = vi.fn();
const writeFileMock = vi.fn();

vi.mock("node:fs/promises", () => ({
  copyFile: copyFileMock,
  mkdir: mkdirMock,
  readdir: readdirMock,
  rename: renameMock,
  stat: statMock,
  unlink: unlinkMock,
  writeFile: writeFileMock
}));

describe("moveFile", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("falls back to copy and delete across filesystems", async () => {
    renameMock.mockRejectedValueOnce(Object.assign(new Error("cross-device"), { code: "EXDEV" }));
    const { moveFile } = await import("../src/utils/fs");

    await moveFile("/tmp/source.mkv", "/Volumes/ExternalShows/dest.mkv");

    expect(mkdirMock).toHaveBeenCalledTimes(1);
    expect(renameMock).toHaveBeenCalledWith("/tmp/source.mkv", "/Volumes/ExternalShows/dest.mkv");
    expect(copyFileMock).toHaveBeenCalledWith("/tmp/source.mkv", "/Volumes/ExternalShows/dest.mkv");
    expect(unlinkMock).toHaveBeenCalledWith("/tmp/source.mkv");
  });
});
