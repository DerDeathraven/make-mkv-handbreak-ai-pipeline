import type { CommandRunner, PipelineLogger, ResolvedConfig } from "../types";
import { assertSuccess } from "../utils/command";

interface FfprobeJson {
  format?: {
    duration?: string;
  };
  streams?: Array<{
    codec_type?: string;
    duration?: string;
  }>;
}

export class FfprobeService {
  constructor(
    private readonly runner: CommandRunner,
    private readonly config: ResolvedConfig,
    private readonly logger: PipelineLogger
  ) {}

  async probe(filePath: string): Promise<{ durationSeconds: number }> {
    const args = [
      "-v",
      "error",
      "-show_format",
      "-show_streams",
      "-of",
      "json",
      filePath
    ];
    this.logger.debug("Probing media", { filePath });
    const result = await this.runner.run(this.config.ffprobe.binaryPath, args);
    assertSuccess(this.config.ffprobe.binaryPath, args, result);
    const parsed = JSON.parse(result.stdout) as FfprobeJson;
    const durationCandidate =
      parsed.format?.duration ??
      parsed.streams?.find((stream) => stream.codec_type === "video")?.duration ??
      parsed.streams?.[0]?.duration;
    const durationSeconds = Number(durationCandidate);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error(`Could not determine duration for ${filePath}`);
    }
    return { durationSeconds };
  }
}
