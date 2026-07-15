import * as vscode from 'vscode';
import { ContainerCliService, ContainerMachine } from './containerCli';
import { resolveSshUser } from './machinesTree';
import { SshUsernameStore, promptSshUsername } from './sshUsernames';

const REMOTE_SSH_EXTENSION_IDS = [
  'anysphere.remote-ssh',
  'ms-vscode-remote.remote-ssh',
] as const;

function findRemoteSshExtension(): vscode.Extension<unknown> | undefined {
  for (const id of REMOTE_SSH_EXTENSION_IDS) {
    const extension = vscode.extensions.getExtension(id);
    if (extension) {
      return extension;
    }
  }
  return undefined;
}

function getPreferredRemoteSshExtensionId(): string {
  return vscode.env.appName.toLowerCase().includes('cursor')
    ? 'anysphere.remote-ssh'
    : 'ms-vscode-remote.remote-ssh';
}

export async function connectViaSsh(
  cli: ContainerCliService,
  machine: ContainerMachine,
  usernameStore: SshUsernameStore,
): Promise<void> {
  if (machine.status !== 'running') {
    const start = 'Start';
    const choice = await vscode.window.showWarningMessage(
      `Machine "${machine.id}" is not running.`,
      start,
    );

    if (choice === start) {
      await vscode.commands.executeCommand('edi-containers.start', machine.id);
    }
    return;
  }

  if (!machine.ipAddress) {
    vscode.window.showWarningMessage(
      `Machine "${machine.id}" has no IP address yet. Try refreshing after it starts.`,
    );
    return;
  }

  const remoteSshExtension = findRemoteSshExtension();
  if (!remoteSshExtension) {
    const install = 'Open Extensions';
    const choice = await vscode.window.showErrorMessage(
      'Remote SSH extension is required to connect.',
      install,
    );

    if (choice === install) {
      const extensionId = getPreferredRemoteSshExtensionId();
      await vscode.commands.executeCommand(
        'workbench.extensions.search',
        `@id:${extensionId}`,
      );
    }
    return;
  }

  if (!remoteSshExtension.isActive) {
    await remoteSshExtension.activate();
  }

  const suggested = await resolveSshUser(cli, machine);
  const username = await promptSshUsername(usernameStore, suggested);
  if (!username) {
    return;
  }

  const remoteAuthority = `ssh-remote+${username}@${machine.ipAddress}`;

  try {
    await vscode.commands.executeCommand('vscode.newWindow', {
      remoteAuthority,
      reuseWindow: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to open Remote SSH window: ${message}`);
  }
}
