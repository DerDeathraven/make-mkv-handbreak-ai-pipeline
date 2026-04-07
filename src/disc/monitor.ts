import type {
  CommandRunner,
  DiscMonitor,
  DiscPresence,
  PipelineLogger,
  ResolvedConfig
} from "../types";
import { assertSuccess } from "../utils/command";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseDrutilStatus(stdout: string): DiscPresence {
  const normalized = stdout.trim();
  if (!normalized) {
    return { present: false, rawOutput: stdout };
  }

  if (/no media/i.test(normalized) || /tray open/i.test(normalized)) {
    return { present: false, rawOutput: stdout };
  }

  const descriptorMatch =
    normalized.match(/Type:\s*(.+)/i) ??
    normalized.match(/Media Name:\s*(.+)/i) ??
    normalized.match(/Name:\s*(.+)/i);

  return {
    present: true,
    descriptor: descriptorMatch?.[1]?.trim(),
    rawOutput: stdout
  };
}

export class PollingDiscMonitor implements DiscMonitor {
  constructor(
    private readonly runner: CommandRunner,
    private readonly config: ResolvedConfig,
    private readonly logger: PipelineLogger
  ) {}

  async poll(): Promise<DiscPresence> {
    const result = await this.runner.run("/usr/bin/drutil", ["status"]);
    assertSuccess("/usr/bin/drutil", ["status"], result);
    return parseDrutilStatus(result.stdout);
  }

  async waitForStableInsertion(): Promise<DiscPresence> {
    const intervalMs = this.config.app.pollIntervalSeconds * 1000;
    const requiredStableMs = this.config.disc.stableInsertSeconds * 1000;
    let stableSince: number | null = null;
    let lastPresence: DiscPresence = { present: false, rawOutput: "" };

    for (;;) {
      const presence = await this.poll();
      lastPresence = presence;
      if (presence.present) {
        stableSince ??= Date.now();
        if (Date.now() - stableSince >= requiredStableMs) {
          this.logger.info("Disc insertion stabilized", {
            descriptor: presence.descriptor ?? "unknown"
          });
          return presence;
        }
      } else {
        stableSince = null;
      }
      await sleep(intervalMs);
    }
  }

  async waitForRemoval(): Promise<void> {
    const intervalMs = this.config.app.pollIntervalSeconds * 1000;
    for (;;) {
      const presence = await this.poll();
      if (!presence.present) {
        this.logger.info("Disc removed");
        return;
      }
      await sleep(intervalMs);
    }
  }
}
