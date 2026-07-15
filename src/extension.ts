import * as vscode from 'vscode';
import {
  ContainerCliService,
  ContainerSystemError,
} from './containerCli';
import {
  MachineTreeItem,
  MachinesTreeProvider,
  resolveMachineId,
} from './machinesTree';
import { connectViaSsh } from './sshConnect';
import { SshUsernameStore } from './sshUsernames';

let refreshTimer: ReturnType<typeof setInterval> | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const cli = new ContainerCliService();
  const treeProvider = new MachinesTreeProvider(cli);
  const usernameStore = new SshUsernameStore(context);

  const treeView = vscode.window.createTreeView('apple-containers.machines', {
    treeDataProvider: treeProvider,
    showCollapseAll: false,
  });

  context.subscriptions.push(treeView);

  const updateTreeMessage = (): void => {
    treeView.message =
      treeProvider.getMachines().length === 0
        ? 'No container machines found.'
        : undefined;
  };

  const refresh = async (showError = true): Promise<void> => {
    try {
      await treeProvider.load();
      treeProvider.refresh();
      updateTreeMessage();
    } catch (error) {
      if (showError) {
        await handleCliError(cli, error);
      }
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('apple-containers.refresh', () =>
      refresh(true),
    ),
    vscode.commands.registerCommand(
      'apple-containers.start',
      async (item?: MachineTreeItem, id?: string) => {
        const machineId = resolveMachineId(item, id);
        if (!machineId) {
          return;
        }

        await runMachineAction(cli, treeProvider, updateTreeMessage, `Starting ${machineId}...`, () =>
          cli.startMachine(machineId),
        );
      },
    ),
    vscode.commands.registerCommand(
      'apple-containers.stop',
      async (item?: MachineTreeItem, id?: string) => {
        const machineId = resolveMachineId(item, id);
        if (!machineId) {
          return;
        }

        await runMachineAction(cli, treeProvider, updateTreeMessage, `Stopping ${machineId}...`, () =>
          cli.stopMachine(machineId),
        );
      },
    ),
    vscode.commands.registerCommand(
      'apple-containers.connectSsh',
      async (item?: MachineTreeItem, id?: string) => {
        const machineId = resolveMachineId(item, id);
        if (!machineId) {
          return;
        }

        let machine = treeProvider.getMachine(machineId);
        if (!machine) {
          await refresh(true);
          machine = treeProvider.getMachine(machineId);
        }

        if (!machine) {
          vscode.window.showErrorMessage(`Machine "${machineId}" not found.`);
          return;
        }

        await connectViaSsh(cli, machine, usernameStore);
      },
    ),
    vscode.commands.registerCommand(
      'apple-containers.copyIp',
      async (item?: MachineTreeItem, id?: string) => {
        const machineId = resolveMachineId(item, id);
        if (!machineId) {
          return;
        }

        let machine = item?.machine ?? treeProvider.getMachine(machineId);
        if (!machine) {
          await refresh(true);
          machine = treeProvider.getMachine(machineId);
        }

        if (!machine?.ipAddress) {
          vscode.window.showWarningMessage(
            `Machine "${machineId}" has no IP address.`,
          );
          return;
        }

        await vscode.env.clipboard.writeText(machine.ipAddress);
        vscode.window.showInformationMessage(
          `Copied IP: ${machine.ipAddress}`,
        );
      },
    ),
    vscode.commands.registerCommand('apple-containers.startSystem', async () => {
      await runMachineAction(
        cli,
        treeProvider,
        updateTreeMessage,
        'Starting container system...',
        () => cli.startSystem(),
      );
    }),
  );

  configureAutoRefresh(context, () => refresh(false));

  void refresh(false);
}

export function deactivate(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = undefined;
  }
}

function configureAutoRefresh(
  context: vscode.ExtensionContext,
  refresh: () => Promise<void>,
): void {
  const updateTimer = () => {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = undefined;
    }

    const interval = vscode.workspace
      .getConfiguration('appleContainers')
      .get<number>('refreshInterval', 8000);

    if (interval > 0) {
      refreshTimer = setInterval(() => {
        void refresh();
      }, interval);
    }
  };

  updateTimer();

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('appleContainers.refreshInterval')) {
        updateTimer();
      }
    }),
  );
}

async function runMachineAction(
  cli: ContainerCliService,
  treeProvider: MachinesTreeProvider,
  updateTreeMessage: () => void,
  progressTitle: string,
  action: () => Promise<void>,
): Promise<void> {
  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: progressTitle,
        cancellable: false,
      },
      action,
    );
    await treeProvider.load();
    treeProvider.refresh();
    updateTreeMessage();
  } catch (error) {
    await handleCliError(cli, error);
  }
}

async function handleCliError(
  cli: ContainerCliService,
  error: unknown,
): Promise<void> {
  if (error instanceof ContainerSystemError) {
    const startSystem = 'Start System';
    const choice = await vscode.window.showErrorMessage(
      'Apple container system is not running or the CLI is unavailable.',
      startSystem,
    );

    if (choice === startSystem) {
      await vscode.commands.executeCommand('apple-containers.startSystem');
    }
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  vscode.window.showErrorMessage(message);
}
