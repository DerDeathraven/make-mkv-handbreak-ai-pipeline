import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CommandResult, CommandRunner } from "../types";

const execFileAsync = promisify(execFile);

export class NodeCommandRunner implements CommandRunner {
  async run(
    command: string,
    args: string[],
    options?: {
      cwd?: string;
      env?: NodeJS.ProcessEnv;
      stdin?: string;
    }
  ): Promise<CommandResult> {
    try {
      const result = await execFileAsync(command, args, {
        cwd: options?.cwd,
        env: options?.env,
        maxBuffer: 20 * 1024 * 1024
      });
      return {
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        exitCode: 0
      };
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & {
        stdout?: string;
        stderr?: string;
        code?: number | string;
      };
      return {
        stdout: failure.stdout ?? "",
        stderr: failure.stderr ?? failure.message,
        exitCode: typeof failure.code === "number" ? failure.code : 1
      };
    }
  }
}

export function assertSuccess(
  command: string,
  args: string[],
  result: CommandResult
): CommandResult {
  if (result.exitCode !== 0) {
    throw new Error(
      `Command failed: ${[command, ...args].join(" ")}\n${result.stderr || result.stdout}`
    );
  }
  return result;
}
