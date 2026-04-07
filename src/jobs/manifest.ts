import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { JobManifest } from "../types";
import { ensureDir } from "../utils/fs";

export class JobManifestStore {
  constructor(private readonly workRoot: string) {}

  get jobsRoot(): string {
    return path.join(this.workRoot, "jobs");
  }

  async save(manifest: JobManifest): Promise<void> {
    manifest.updatedAt = new Date().toISOString();
    await ensureDir(manifest.workDir);
    await writeFile(
      path.join(manifest.workDir, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf8"
    );
  }

  async load(manifestPath: string): Promise<JobManifest> {
    const content = await readFile(manifestPath, "utf8");
    return JSON.parse(content) as JobManifest;
  }

  async listPending(): Promise<JobManifest[]> {
    await ensureDir(this.jobsRoot);
    const entries = await readdir(this.jobsRoot, { withFileTypes: true });
    const manifests: JobManifest[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const manifestPath = path.join(this.jobsRoot, entry.name, "manifest.json");
      try {
        const manifest = await this.load(manifestPath);
        if (manifest.status !== "completed") {
          manifests.push(manifest);
        }
      } catch {
        continue;
      }
    }
    manifests.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    return manifests;
  }
}
