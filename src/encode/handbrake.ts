import path from "node:path";
import { writeFile } from "node:fs/promises";
import type { CommandRunner, PipelineLogger, ResolvedConfig } from "../types";
import { assertSuccess } from "../utils/command";

export class HandBrakeService {
  constructor(
    private readonly runner: CommandRunner,
    private readonly config: ResolvedConfig,
    private readonly logger: PipelineLogger
  ) {}

  async encode(inputPath: string, outputPath: string): Promise<string> {
    const args = [
      "--json",
      "-i",
      inputPath,
      "-o",
      outputPath,
      "-f",
      "av_mkv",
      "-Z",
      this.config.handbrake.presetName
    ];

    if (this.config.handbrake.presetImportFile) {
      args.unshift(
        "--preset-import-file",
        this.config.handbrake.presetImportFile
      );
    }

    this.logger.info("Encoding title with HandBrakeCLI", {
      inputPath,
      outputPath,
      presetName: this.config.handbrake.presetName
    });
    const result = await this.runner.run(this.config.handbrake.binaryPath, args);
    const logPath = `${outputPath}.handbrake.log`;
    await writeFile(
      logPath,
      [result.stdout, result.stderr].filter(Boolean).join("\n"),
      "utf8"
    );
    assertSuccess(this.config.handbrake.binaryPath, args, result);
    return logPath;
  }

  buildEncodedPath(encodedDir: string, sourcePath: string): string {
    const baseName = path.basename(sourcePath, path.extname(sourcePath));
    return path.join(encodedDir, `${baseName}.mkv`);
  }
}
