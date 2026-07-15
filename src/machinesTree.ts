import * as os from 'os';
import * as vscode from 'vscode';
import {
  ContainerCliService,
  ContainerMachine,
  MachineInspect,
} from './containerCli';

export class MachineTreeItem extends vscode.TreeItem {
  constructor(public readonly machine: ContainerMachine) {
    super(machine.id, vscode.TreeItemCollapsibleState.None);

    const isRunning = machine.status === 'running';
    const ip = machine.ipAddress ?? '—';

    this.description = `${machine.status} · ${ip}`;
    this.tooltip = buildTooltip(machine);
    this.iconPath = new vscode.ThemeIcon(
      isRunning ? 'vm-running' : 'vm-outline',
      isRunning
        ? new vscode.ThemeColor('charts.green')
        : new vscode.ThemeColor('descriptionForeground'),
    );
    this.contextValue = [
      isRunning ? 'machineRunning' : 'machineStopped',
      machine.ipAddress ? 'machineHasIp' : undefined,
    ]
      .filter(Boolean)
      .join(' ');
  }
}

function buildTooltip(machine: ContainerMachine): string {
  const lines = [
    `ID: ${machine.id}`,
    `Status: ${machine.status}`,
    `IP: ${machine.ipAddress ?? '—'}`,
  ];

  if (machine.cpus !== undefined) {
    lines.push(`CPUs: ${machine.cpus}`);
  }

  if (machine.memory !== undefined) {
    lines.push(`Memory: ${formatBytes(machine.memory)}`);
  }

  if (machine.default) {
    lines.push('Default machine');
  }

  return lines.join('\n');
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export class MachinesTreeProvider
  implements vscode.TreeDataProvider<MachineTreeItem>
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    MachineTreeItem | undefined | null | void
  >();

  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private machines: ContainerMachine[] = [];
  private loadError: string | undefined;

  constructor(private readonly cli: ContainerCliService) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: MachineTreeItem): vscode.TreeItem {
    return element;
  }

  async load(): Promise<ContainerMachine[]> {
    try {
      this.machines = await this.cli.listMachines();
      this.loadError = undefined;
      return this.machines;
    } catch (error) {
      this.machines = [];
      this.loadError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  async getChildren(): Promise<MachineTreeItem[]> {
    const machines = await this.load();
    return machines.map((machine) => new MachineTreeItem(machine));
  }

  getMachine(id: string): ContainerMachine | undefined {
    return this.machines.find((machine) => machine.id === id);
  }

  getMachines(): ContainerMachine[] {
    return this.machines;
  }

  getLoadError(): string | undefined {
    return this.loadError;
  }
}

export function resolveMachineId(
  item?: MachineTreeItem,
  id?: string,
): string | undefined {
  return item?.machine.id ?? id;
}

export async function resolveSshUser(
  cli: ContainerCliService,
  machine: ContainerMachine,
): Promise<string> {
  try {
    const inspect: MachineInspect = await cli.inspectMachine(machine.id);
    if (inspect.userSetup?.username) {
      return inspect.userSetup.username;
    }
  } catch {
    // Fall back to host username.
  }

  return os.userInfo().username;
}
