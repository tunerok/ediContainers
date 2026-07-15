import { execFile } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 60_000;
const BUILD_TIMEOUT_MS = 15 * 60_000;

export interface ContainerMachine {
  id: string;
  status: string;
  ipAddress?: string;
  cpus?: number;
  memory?: number;
  default?: boolean;
  createdDate?: string;
}

export interface MachineInspect {
  id: string;
  status: string;
  ipAddress?: string;
  cpus?: number;
  memory?: number;
  userSetup?: {
    username?: string;
    uid?: number;
    gid?: number;
  };
}

export class ContainerSystemError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContainerSystemError';
  }
}

export class ContainerCliService {
  private getBinary(): string {
    return vscode.workspace
      .getConfiguration('ediContainers')
      .get<string>('containerPath', 'container');
  }

  private isSystemError(message: string): boolean {
    const lower = message.toLowerCase();
    return (
      lower.includes('system services are not running') ||
      lower.includes('plugin') ||
      lower.includes('not found') ||
      lower.includes('enoent')
    );
  }

  private async run(
    args: string[],
    options?: { timeoutMs?: number },
  ): Promise<string> {
    const binary = this.getBinary();
    const timeout = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    try {
      const { stdout } = await execFileAsync(binary, args, {
        encoding: 'utf8',
        env: process.env,
        maxBuffer: 20 * 1024 * 1024,
        timeout,
      });
      return stdout.trim();
    } catch (error) {
      const execError = error as NodeJS.ErrnoException & {
        stderr?: string;
        stdout?: string;
        killed?: boolean;
      };

      if (execError.killed) {
        throw new Error(
          `Command timed out after ${Math.round(timeout / 1000)}s: ${binary} ${args.join(' ')}`,
        );
      }

      const message = [
        execError.stderr?.trim(),
        execError.stdout?.trim(),
        execError.message,
      ]
        .filter(Boolean)
        .join('\n');

      if (execError.code === 'ENOENT' || this.isSystemError(message)) {
        throw new ContainerSystemError(message || `Failed to run ${binary}`);
      }

      throw new Error(message || `Failed to run ${binary}`);
    }
  }

  async listMachines(): Promise<ContainerMachine[]> {
    const output = await this.run(['machine', 'list', '--format', 'json']);
    if (!output) {
      return [];
    }

    const parsed = JSON.parse(output) as ContainerMachine[];
    return Array.isArray(parsed) ? parsed : [];
  }

  async inspectMachine(id: string): Promise<MachineInspect> {
    const output = await this.run(['machine', 'inspect', id]);
    const parsed = JSON.parse(output) as MachineInspect | MachineInspect[];
    return Array.isArray(parsed) ? parsed[0] : parsed;
  }

  async stopMachine(id: string): Promise<void> {
    await this.run(['machine', 'stop', id]);
  }

  async startMachine(id: string): Promise<void> {
    await this.run(['machine', 'run', '-n', id, '-d', '--', 'true']);
  }

  async startSystem(): Promise<void> {
    await this.run(['system', 'start']);
  }

  async createMachine(image: string, name: string): Promise<void> {
    await this.run(['machine', 'create', image, '--name', name], {
      timeoutMs: BUILD_TIMEOUT_MS,
    });
  }

  async deleteMachine(id: string): Promise<void> {
    await this.run(['machine', 'delete', id]);
  }

  async buildImage(
    contextPath: string,
    tag: string,
    buildArgs?: Record<string, string>,
  ): Promise<void> {
    const args = ['build', '--tag', tag];
    if (buildArgs) {
      for (const [key, value] of Object.entries(buildArgs)) {
        args.push('--build-arg', `${key}=${value}`);
      }
    }
    args.push(contextPath);
    await this.run(args, { timeoutMs: BUILD_TIMEOUT_MS });
  }

  async imageExists(tag: string): Promise<boolean> {
    try {
      const output = await this.run(['image', 'list', '--format', 'json']);
      if (!output) {
        return false;
      }
      const parsed = JSON.parse(output) as unknown;
      if (!Array.isArray(parsed)) {
        return output.includes(tag);
      }
      return parsed.some((entry) => imageEntryMatchesTag(entry, tag));
    } catch {
      try {
        await this.run(['image', 'inspect', tag]);
        return true;
      } catch {
        return false;
      }
    }
  }
}

function imageEntryMatchesTag(entry: unknown, tag: string): boolean {
  if (!entry || typeof entry !== 'object') {
    return false;
  }
  const item = entry as Record<string, unknown>;
  const candidates = [
    item.reference,
    item.Reference,
    item.name,
    item.Name,
    item.tag,
    item.Tag,
    item.id,
    item.ID,
  ];
  if (typeof item.repository === 'string' && typeof item.tag === 'string') {
    candidates.push(`${item.repository}:${item.tag}`);
  }
  if (Array.isArray(item.names)) {
    candidates.push(...item.names);
  }
  if (Array.isArray(item.Names)) {
    candidates.push(...item.Names);
  }
  return candidates.some(
    (value) => typeof value === 'string' && valueIncludesTag(value, tag),
  );
}

function valueIncludesTag(value: string, tag: string): boolean {
  return value === tag || value.endsWith(`/${tag}`) || value.includes(tag);
}
