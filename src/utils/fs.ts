import { copyFile, mkdir, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export async function ensureDir(targetPath: string): Promise<void> {
  await mkdir(targetPath, { recursive: true });
}

export async function ensureParentDir(targetPath: string): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });
}

export async function listFilesWithExtension(
  dirPath: string,
  extension: string
): Promise<string[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(extension.toLowerCase()))
    .map((entry) => path.join(dirPath, entry.name))
    .sort((left, right) =>
      path.basename(left).localeCompare(path.basename(right), undefined, {
        numeric: true,
        sensitivity: "base"
      })
    );
}

export async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function moveFile(sourcePath: string, destinationPath: string): Promise<void> {
  await ensureParentDir(destinationPath);
  try {
    await rename(sourcePath, destinationPath);
  } catch (error) {
    const failure = error as NodeJS.ErrnoException;
    if (failure.code !== "EXDEV") {
      throw failure;
    }
    await copyFile(sourcePath, destinationPath);
    await unlink(sourcePath);
  }
}

export async function removeFileIfExists(targetPath: string): Promise<void> {
  try {
    await unlink(targetPath);
  } catch (error) {
    const failure = error as NodeJS.ErrnoException;
    if (failure.code !== "ENOENT") {
      throw failure;
    }
  }
}

export async function writeTextFile(targetPath: string, content: string): Promise<void> {
  await ensureParentDir(targetPath);
  await writeFile(targetPath, content, "utf8");
}
