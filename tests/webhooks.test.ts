import { afterEach, describe, expect, it } from "vitest";
import type { JobManifest, TitleJobRecord, WebhookConfig } from "../src/types";
import { WebhookDispatcher } from "../src/notifications/webhooks";
import { noopLogger } from "./helpers";

describe("WebhookDispatcher", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function createConfig(overrides?: Partial<WebhookConfig>): WebhookConfig {
    return {
      enabled: true,
      timeoutMs: 100,
      maxRetries: 2,
      retryBackoffMs: 1,
      events: {},
      ...overrides
    };
  }

  function createManifest(): JobManifest {
    return {
      version: 1,
      jobId: "job-1",
      createdAt: "2026-04-09T10:00:00.000Z",
      updatedAt: "2026-04-09T10:00:00.000Z",
      status: "ripping",
      discLabel: "DISC_2",
      showTitle: "The Librarians",
      seasonNumber: 1,
      workDir: "/tmp/work/job-1",
      ripDir: "/tmp/work/job-1/rip",
      encodedDir: "/tmp/work/job-1/encoded",
      reviewDir: "/tmp/work/job-1/review",
      rippedTitles: [],
      mappings: [],
      titleJobs: [],
      errors: []
    };
  }

  function createTitleJob(): TitleJobRecord {
    return {
      titleIndex: 2,
      sourcePath: "/tmp/work/job-1/rip/title-2.mkv",
      finalPath: "/tmp/library/title-2.mkv",
      classification: "episode",
      episodeNumbers: [5],
      status: "moved",
      reason: "match"
    };
  }

  it("sends the minimal payload for job events", async () => {
    const deliveries: Array<{ url: string; payload: Record<string, unknown> }> = [];
    globalThis.fetch = async (input, init) => {
      deliveries.push({
        url: String(input),
        payload: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
      });
      return new Response("ok", { status: 200 });
    };

    const dispatcher = new WebhookDispatcher(
      createConfig({
        events: {
          "job.ripping": [{ url: "https://example.test/job-ripping" }]
        }
      }),
      noopLogger
    );

    await dispatcher.emitJobEvent("job.ripping", createManifest());

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({
      url: "https://example.test/job-ripping"
    });
    expect(deliveries[0]?.payload).toMatchObject({
      event: "job.ripping",
      job_id: "job-1",
      job_status: "ripping",
      disc_label: "DISC_2",
      show_title: "The Librarians",
      season_number: 1
    });
    expect(deliveries[0]?.payload).not.toHaveProperty("title_index");
    expect(deliveries[0]?.payload).not.toHaveProperty("sourcePath");
  });

  it("sends the minimal payload for title events", async () => {
    const deliveries: Array<Record<string, unknown>> = [];
    globalThis.fetch = async (_input, init) => {
      deliveries.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      return new Response("ok", { status: 200 });
    };

    const dispatcher = new WebhookDispatcher(
      createConfig({
        events: {
          "title.moved": [{ url: "https://example.test/title-moved" }]
        }
      }),
      noopLogger
    );

    await dispatcher.emitTitleEvent("title.moved", createManifest(), createTitleJob());

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({
      event: "title.moved",
      title_index: 2,
      title_status: "moved",
      classification: "episode",
      episode_numbers: [5]
    });
    expect(deliveries[0]).not.toHaveProperty("sourcePath");
    expect(deliveries[0]).not.toHaveProperty("finalPath");
  });

  it("retries on non-2xx responses and stops after success", async () => {
    let attempts = 0;
    globalThis.fetch = async () => {
      attempts += 1;
      if (attempts < 3) {
        return new Response("bad", { status: 500 });
      }
      return new Response("ok", { status: 200 });
    };

    const dispatcher = new WebhookDispatcher(
      createConfig({
        maxRetries: 2,
        events: {
          "job.failed": [{ url: "https://example.test/job-failed" }]
        }
      }),
      noopLogger
    );

    const manifest = createManifest();
    manifest.status = "failed";
    await dispatcher.emitJobEvent("job.failed", manifest);

    expect(attempts).toBe(3);
  });

  it("stops after max retries and never throws back to the caller", async () => {
    let attempts = 0;
    globalThis.fetch = async () => {
      attempts += 1;
      throw new Error("network down");
    };

    const dispatcher = new WebhookDispatcher(
      createConfig({
        maxRetries: 1,
        events: {
          "title.failed": [{ url: "https://example.test/title-failed" }]
        }
      }),
      noopLogger
    );

    const manifest = createManifest();
    manifest.status = "failed";
    const titleJob = createTitleJob();
    titleJob.status = "failed";

    await expect(dispatcher.emitTitleEvent("title.failed", manifest, titleJob)).resolves.toBeUndefined();
    expect(attempts).toBe(2);
  });
});
