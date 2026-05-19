import { execFile } from 'node:child_process';

export type ExecCommandOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv | undefined;
};

export async function execCommand(command: string, args: string[], options?: ExecCommandOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd: options?.cwd, env: options?.env }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(stdout.trim());
    });
  });
}