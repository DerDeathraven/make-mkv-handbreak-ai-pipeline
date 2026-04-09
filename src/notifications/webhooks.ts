import type {
  JobManifest,
  PipelineLogger,
  TitleJobRecord,
  WebhookConfig,
  WebhookEventName,
  WebhookJobPayload,
  WebhookTitlePayload
} from "../types";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTitleEvent(eventName: WebhookEventName): eventName is
  | "title.moved"
  | "title.skipped"
  | "title.review"
  | "title.conflict"
  | "title.failed" {
  return eventName.startsWith("title.");
}

export class WebhookDispatcher {
  constructor(
    private readonly config: WebhookConfig,
    private readonly logger: PipelineLogger
  ) {}

  async emitJobEvent(eventName: WebhookEventName, manifest: JobManifest): Promise<void> {
    if (!this.config.enabled || isTitleEvent(eventName)) {
      return;
    }

    const payload: WebhookJobPayload = {
      event: eventName,
      timestamp: new Date().toISOString(),
      job_id: manifest.jobId,
      job_status: manifest.status,
      disc_label: manifest.discLabel,
      show_title: manifest.showTitle,
      season_number: manifest.seasonNumber
    };

    await this.dispatch(eventName, payload);
  }

  async emitTitleEvent(
    eventName: WebhookEventName,
    manifest: JobManifest,
    titleJob: TitleJobRecord
  ): Promise<void> {
    if (!this.config.enabled || !isTitleEvent(eventName)) {
      return;
    }

    const payload: WebhookTitlePayload = {
      event: eventName,
      timestamp: new Date().toISOString(),
      job_id: manifest.jobId,
      job_status: manifest.status,
      disc_label: manifest.discLabel,
      show_title: manifest.showTitle,
      season_number: manifest.seasonNumber,
      title_index: titleJob.titleIndex,
      title_status: titleJob.status,
      classification: titleJob.classification,
      episode_numbers: titleJob.episodeNumbers
    };

    await this.dispatch(eventName, payload);
  }

  private async dispatch(
    eventName: WebhookEventName,
    payload: WebhookJobPayload | WebhookTitlePayload
  ): Promise<void> {
    const endpoints = this.config.events[eventName] ?? [];
    for (const endpoint of endpoints) {
      await this.postWithRetries(endpoint.url, eventName, payload);
    }
  }

  private async postWithRetries(
    url: string,
    eventName: WebhookEventName,
    payload: WebhookJobPayload | WebhookTitlePayload
  ): Promise<void> {
    const attempts = this.config.maxRetries + 1;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), this.config.timeoutMs);

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        clearTimeout(timeoutHandle);

        if (!response.ok) {
          throw new Error(`Webhook returned HTTP ${response.status}`);
        }

        this.logger.debug("Webhook delivered", {
          event: eventName,
          url,
          attempt
        });
        return;
      } catch (error) {
        clearTimeout(timeoutHandle);
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (attempt < attempts) {
          this.logger.warn("Webhook delivery failed, retrying", {
            event: eventName,
            url,
            attempt,
            error: errorMessage
          });
          await sleep(this.config.retryBackoffMs * attempt);
          continue;
        }

        this.logger.error("Webhook delivery failed", {
          event: eventName,
          url,
          attempt,
          error: errorMessage
        });
      }
    }
  }
}
