import * as vscode from 'vscode';
import {
  ContainerCliMissingError,
  ContainerCliService,
  ContainerPluginError,
  ContainerSystemError,
} from './containerCli';
import {
  MachineImagesConfigService,
  MachineImageTemplate,
} from './machineImagesConfig';
import {
  MachineTreeItem,
  MachinesTreeProvider,
  resolveMachineId,
} from './machinesTree';
import { connectViaSsh } from './sshConnect';
import { SshUsernameStore } from './sshUsernames';

const INSTALL_PAGE = 'https://github.com/apple/container/releases';
const INSTALL_COMMAND = 'brew install --cask container';
const SYSTEM_TOGGLE_COOLDOWN_MS = 3_000;

let refreshTimer: ReturnType<typeof setInterval> | undefined;
let systemUnlockTimer: ReturnType<typeof setTimeout> | undefined;
let missingCliPrompted = false;
let systemBusy = false;

export function activate(context: vscode.ExtensionContext): void {
  const cli = new ContainerCliService();
  const treeProvider = new MachinesTreeProvider(cli);
  const usernameStore = new SshUsernameStore(context);
  const imagesConfig = new MachineImagesConfigService(context);

  const treeView = vscode.window.createTreeView('edi-containers.machines', {
    treeDataProvider: treeProvider,
    showCollapseAll: false,
  });

  context.subscriptions.push(treeView);

  const updateTreeMessage = (error?: unknown): void => {
    if (error instanceof ContainerCliMissingError) {
      treeView.message = `Apple container CLI was not found ("${error.binary}"). Install it, then start the system.`;
      return;
    }

    if (error instanceof ContainerPluginError) {
      treeView.message =
        'Apple container install looks broken. Reinstall the container CLI.';
      return;
    }

    if (error instanceof ContainerSystemError) {
      treeView.message = 'Container system is not started.';
      return;
    }

    if (error) {
      treeView.message = error instanceof Error ? error.message : String(error);
      return;
    }

    treeView.message =
      treeProvider.getMachines().length === 0
        ? 'No container machines found. Use + to create one from a template.'
        : undefined;
  };

  const refresh = async (showError = true): Promise<void> => {
    try {
      await treeProvider.load();
      treeProvider.refresh();
      updateTreeMessage();
      setSystemRunning(true);
    } catch (error) {
      updateTreeMessage(error);
      treeProvider.refresh();
      if (isCliStateError(error)) {
        setSystemRunning(false);
      }
      const showMissing =
        error instanceof ContainerCliMissingError && !missingCliPrompted;
      if (showMissing) {
        missingCliPrompted = true;
      }
      if (showError || showMissing) {
        await handleCliError(error);
      }
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('edi-containers.refresh', () =>
      refresh(true),
    ),
    vscode.commands.registerCommand(
      'edi-containers.start',
      async (item?: MachineTreeItem, id?: string) => {
        const machineId = resolveMachineId(item, id);
        if (!machineId) {
          return;
        }

        await runMachineAction(
          treeProvider,
          updateTreeMessage,
          `Starting ${machineId}...`,
          () => cli.startMachine(machineId),
        );
      },
    ),
    vscode.commands.registerCommand(
      'edi-containers.stop',
      async (item?: MachineTreeItem, id?: string) => {
        const machineId = resolveMachineId(item, id);
        if (!machineId) {
          return;
        }

        await runMachineAction(
          treeProvider,
          updateTreeMessage,
          `Stopping ${machineId}...`,
          () => cli.stopMachine(machineId),
        );
      },
    ),
    vscode.commands.registerCommand(
      'edi-containers.connectSsh',
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
      'edi-containers.copyIp',
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
        vscode.window.showInformationMessage(`Copied IP: ${machine.ipAddress}`);
      },
    ),
    vscode.commands.registerCommand('edi-containers.startSystem', async () => {
      if (!lockSystemToggle()) {
        return;
      }

      try {
        const started = await runMachineAction(
          treeProvider,
          updateTreeMessage,
          'Starting container system...',
          () => cli.startSystem(),
        );
        setSystemRunning(started, true);
      } finally {
        scheduleSystemToggleUnlock();
      }
    }),
    vscode.commands.registerCommand('edi-containers.stopSystem', async () => {
      if (!lockSystemToggle()) {
        return;
      }

      let cancelled = false;
      try {
        const confirm = await vscode.window.showWarningMessage(
          'Stop the Apple container system? Running machines will stop.',
          { modal: true },
          'Stop',
        );
        if (confirm !== 'Stop') {
          cancelled = true;
          return;
        }

        try {
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: 'Stopping container system...',
              cancellable: false,
            },
            () => cli.stopSystem(),
          );
          treeProvider.markSystemStopped();
          treeView.message = 'Container system is stopped.';
          treeProvider.refresh();
          setSystemRunning(false, true);
        } catch (error) {
          if (error instanceof ContainerSystemError) {
            setSystemRunning(false, true);
          }
          if (isCliStateError(error)) {
            updateTreeMessage(error);
            treeProvider.refresh();
          }
          await handleCliError(error);
        }
      } finally {
        if (cancelled) {
          releaseSystemToggleLock();
        } else {
          scheduleSystemToggleUnlock();
        }
      }
    }),
    vscode.commands.registerCommand('edi-containers.createMachine', async () => {
      await createMachineFromTemplate(
        cli,
        imagesConfig,
        usernameStore,
        treeProvider,
        updateTreeMessage,
      );
    }),
    vscode.commands.registerCommand(
      'edi-containers.deleteMachine',
      async (item?: MachineTreeItem, id?: string) => {
        const machineId = resolveMachineId(item, id);
        if (!machineId) {
          return;
        }

        const confirm = await vscode.window.showWarningMessage(
          `Delete machine "${machineId}"? This cannot be undone.`,
          { modal: true },
          'Delete',
        );
        if (confirm !== 'Delete') {
          return;
        }

        await runMachineAction(
          treeProvider,
          updateTreeMessage,
          `Deleting ${machineId}...`,
          async () => {
            const machine = treeProvider.getMachine(machineId);
            const status = machine?.status?.toLowerCase() ?? '';
            if (status.includes('run')) {
              await cli.stopMachine(machineId);
            }
            await cli.deleteMachine(machineId);
          },
        );
      },
    ),
    vscode.commands.registerCommand(
      'edi-containers.editImageSettings',
      async () => {
        await imagesConfig.openUserConfig();
      },
    ),
    vscode.commands.registerCommand(
      'edi-containers.editCustomDockerfile',
      async () => {
        await imagesConfig.openCustomDockerfile();
      },
    ),
  );

  setSystemRunning(false);
  setSystemBusy(false);
  void imagesConfig.ensureUserConfig();
  configureAutoRefresh(context, () => refresh(false));
  void refresh(false);
}

export function deactivate(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = undefined;
  }
  if (systemUnlockTimer) {
    clearTimeout(systemUnlockTimer);
    systemUnlockTimer = undefined;
  }
}

async function createMachineFromTemplate(
  cli: ContainerCliService,
  imagesConfig: MachineImagesConfigService,
  usernameStore: SshUsernameStore,
  treeProvider: MachinesTreeProvider,
  updateTreeMessage: (error?: unknown) => void,
): Promise<void> {
  let templates: MachineImageTemplate[];
  try {
    templates = await imagesConfig.loadTemplates(true);
  } catch (error) {
    await handleCliError(error);
    return;
  }

  type PickItem = vscode.QuickPickItem & {
    kind?: 'preset' | 'custom' | 'edit-custom';
    template?: MachineImageTemplate;
  };

  const items: PickItem[] = [
    ...templates.map(
      (template): PickItem => ({
        label: template.label,
        description: template.baseImage,
        detail: template.description,
        kind: 'preset',
        template,
      }),
    ),
    {
      label: 'Custom Dockerfile',
      description: 'your Dockerfile',
      detail:
        'Build from a hand-written Dockerfile (presets stay untouched). Opens editor if missing.',
      kind: 'custom',
    },
    {
      label: 'Edit Custom Dockerfile…',
      description: 'open only',
      detail: 'Edit your custom Dockerfile without creating a machine.',
      kind: 'edit-custom',
    },
  ];

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Create Machine',
    placeHolder: 'Choose a preset or Custom Dockerfile',
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!picked) {
    return;
  }

  if (picked.kind === 'edit-custom') {
    await imagesConfig.openCustomDockerfile();
    return;
  }

  if (picked.kind === 'custom') {
    await createMachineFromCustomDockerfile(
      cli,
      imagesConfig,
      treeProvider,
      updateTreeMessage,
    );
    return;
  }

  if (!picked.template) {
    return;
  }

  const name = await promptMachineName();
  if (!name) {
    return;
  }

  const machineName = name;
  const template = picked.template;
  const contextPath = imagesConfig.templateContextPath(template.id);

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Creating machine "${machineName}"`,
        cancellable: false,
      },
      async (progress) => {
        const lastBase = await imagesConfig.getBuiltBaseImage(template.id);
        const exists = await cli.imageExists(template.localTag);
        const needsBuild = !exists || lastBase !== template.baseImage;

        if (needsBuild) {
          progress.report({
            message: `Building ${template.localTag} from ${template.baseImage}…`,
          });
          await cli.buildImage(contextPath, template.localTag, {
            BASE_IMAGE: template.baseImage,
          });
          await imagesConfig.setBuiltBaseImage(template.id, template.baseImage);
        } else {
          progress.report({ message: `Using existing image ${template.localTag}` });
        }

        progress.report({ message: 'Creating machine…' });
        await cli.createMachine(template.localTag, machineName);
      },
    );

    await usernameStore.remember('root');
    await treeProvider.load();
    treeProvider.refresh();
    updateTreeMessage();

    vscode.window.showInformationMessage(
      `Machine "${machineName}" created. SSH: root / root`,
    );
  } catch (error) {
    if (isCliStateError(error)) {
      updateTreeMessage(error);
    }
    await handleCliError(error);
  }
}

async function createMachineFromCustomDockerfile(
  cli: ContainerCliService,
  imagesConfig: MachineImagesConfigService,
  treeProvider: MachinesTreeProvider,
  updateTreeMessage: (error?: unknown) => void,
): Promise<void> {
  const dockerfilePath = await imagesConfig.ensureCustomDockerfile();
  await imagesConfig.openCustomDockerfile();

  const proceed = await vscode.window.showInformationMessage(
    `Edit your Dockerfile, then continue. Path:\n${dockerfilePath}`,
    'Build & Create',
    'Cancel',
  );
  if (proceed !== 'Build & Create') {
    return;
  }

  const lastTag = await imagesConfig.getLastCustomTag();
  const tag = await vscode.window.showInputBox({
    title: 'Image tag',
    prompt: 'Local tag for the custom image (no preset BASE_IMAGE injection)',
    value: lastTag,
    placeHolder: 'edi-containers/custom:local',
    validateInput: (value) => {
      const trimmed = value.trim();
      if (!trimmed) {
        return 'Tag cannot be empty';
      }
      if (/\s/.test(trimmed)) {
        return 'Tag must not contain spaces';
      }
      return undefined;
    },
  });
  if (!tag) {
    return;
  }

  const imageTag = tag.trim();
  await imagesConfig.setLastCustomTag(imageTag);

  const name = await promptMachineName();
  if (!name) {
    return;
  }

  const machineName = name;
  const contextPath = imagesConfig.getCustomContextPath();
  const fingerprint = await imagesConfig.getCustomDockerfileFingerprint();

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Creating machine "${machineName}" from custom Dockerfile`,
        cancellable: false,
      },
      async (progress) => {
        const lastFingerprint = await imagesConfig.getBuiltBaseImage('custom');
        const exists = await cli.imageExists(imageTag);
        const needsBuild = !exists || lastFingerprint !== fingerprint;

        if (needsBuild) {
          progress.report({ message: `Building ${imageTag} (no preset args)…` });
          // No BASE_IMAGE build-arg — Dockerfile is fully user-controlled.
          await cli.buildImage(contextPath, imageTag);
          await imagesConfig.setBuiltBaseImage('custom', fingerprint);
        } else {
          progress.report({ message: `Using existing image ${imageTag}` });
        }

        progress.report({ message: 'Creating machine…' });
        await cli.createMachine(imageTag, machineName);
      },
    );

    await treeProvider.load();
    treeProvider.refresh();
    updateTreeMessage();

    vscode.window.showInformationMessage(
      `Machine "${machineName}" created from custom Dockerfile (${imageTag}).`,
    );
  } catch (error) {
    if (isCliStateError(error)) {
      updateTreeMessage(error);
    }
    await handleCliError(error);
  }
}

async function promptMachineName(): Promise<string | undefined> {
  const name = await vscode.window.showInputBox({
    title: 'Machine name',
    prompt: 'Name for the new container machine',
    placeHolder: 'dev',
    validateInput: (value) => {
      const trimmed = value.trim();
      if (!trimmed) {
        return 'Name cannot be empty';
      }
      if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(trimmed)) {
        return 'Lowercase letters, digits, hyphens only (e.g. dev)';
      }
      return undefined;
    },
  });
  return name?.trim();
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
      .getConfiguration('ediContainers')
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
      if (event.affectsConfiguration('ediContainers.refreshInterval')) {
        updateTimer();
      }
    }),
  );
}

async function runMachineAction(
  treeProvider: MachinesTreeProvider,
  updateTreeMessage: (error?: unknown) => void,
  progressTitle: string,
  action: () => Promise<void>,
): Promise<boolean> {
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
    return true;
  } catch (error) {
    if (isCliStateError(error)) {
      updateTreeMessage(error);
      treeProvider.refresh();
    }
    await handleCliError(error);
    return false;
  }
}

function setSystemRunning(running: boolean, force = false): void {
  if (systemBusy && !force) {
    return;
  }
  void vscode.commands.executeCommand(
    'setContext',
    'ediContainers.systemRunning',
    running,
  );
}

function setSystemBusy(busy: boolean): void {
  systemBusy = busy;
  void vscode.commands.executeCommand(
    'setContext',
    'ediContainers.systemBusy',
    busy,
  );
}

function lockSystemToggle(): boolean {
  if (systemBusy) {
    return false;
  }
  if (systemUnlockTimer) {
    clearTimeout(systemUnlockTimer);
    systemUnlockTimer = undefined;
  }
  setSystemBusy(true);
  return true;
}

function scheduleSystemToggleUnlock(): void {
  if (systemUnlockTimer) {
    clearTimeout(systemUnlockTimer);
  }
  systemUnlockTimer = setTimeout(() => {
    systemUnlockTimer = undefined;
    setSystemBusy(false);
  }, SYSTEM_TOGGLE_COOLDOWN_MS);
}

function releaseSystemToggleLock(): void {
  if (systemUnlockTimer) {
    clearTimeout(systemUnlockTimer);
    systemUnlockTimer = undefined;
  }
  setSystemBusy(false);
}

function isCliStateError(error: unknown): boolean {
  return (
    error instanceof ContainerCliMissingError ||
    error instanceof ContainerPluginError ||
    error instanceof ContainerSystemError
  );
}

async function handleCliError(error: unknown): Promise<void> {
  if (error instanceof ContainerCliMissingError) {
    const openPage = 'Open Install Page';
    const copyCommand = 'Copy Install Command';
    const choice = await vscode.window.showErrorMessage(
      `Apple container CLI was not found ("${error.binary}"). Install it with "${INSTALL_COMMAND}", or download the signed .pkg from the Apple container releases. Then run "container system start".`,
      openPage,
      copyCommand,
    );

    if (choice === openPage) {
      await vscode.env.openExternal(vscode.Uri.parse(INSTALL_PAGE));
    } else if (choice === copyCommand) {
      await vscode.env.clipboard.writeText(INSTALL_COMMAND);
      vscode.window.showInformationMessage(`Copied: ${INSTALL_COMMAND}`);
    }
    return;
  }

  if (error instanceof ContainerPluginError) {
    const openPage = 'Open Install Page';
    const choice = await vscode.window.showErrorMessage(
      'Apple container install looks broken (plugin missing). Reinstall the container CLI, then run container system start.',
      openPage,
    );

    if (choice === openPage) {
      await vscode.env.openExternal(vscode.Uri.parse(INSTALL_PAGE));
    }
    return;
  }

  if (error instanceof ContainerSystemError) {
    const startSystem = 'Start System';
    const choice = await vscode.window.showErrorMessage(
      'Container system is not started.',
      startSystem,
    );

    if (choice === startSystem) {
      await vscode.commands.executeCommand('edi-containers.startSystem');
    }
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  vscode.window.showErrorMessage(message);
}
