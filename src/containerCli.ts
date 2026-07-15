import { execFile } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';

const execFileAsync = promisify(execFile);

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
      .getConfiguration('appleContainers')
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

  private async run(args: string[]): Promise<string> {
    const binary = this.getBinary();

    try {
      const { stdout } = await execFileAsync(binary, args, {
        encoding: 'utf8',
        env: process.env,
        maxBuffer: 10 * 1024 * 1024,
      });
      return stdout.trim();
    } catch (error) {
      const execError = error as NodeJS.ErrnoException & {
        stderr?: string;
        stdout?: string;
      };

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
}
