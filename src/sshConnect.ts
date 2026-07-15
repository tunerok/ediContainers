import * as vscode from 'vscode';
import { ContainerCliService, ContainerMachine } from './containerCli';
import { resolveSshUser } from './machinesTree';

const REMOTE_SSH_EXTENSION_ID = 'ms-vscode-remote.remote-ssh';

export async function connectViaSsh(
  cli: ContainerCliService,
  machine: ContainerMachine,
): Promise<void> {
  if (machine.status !== 'running') {
    const start = 'Start';
    const choice = await vscode.window.showWarningMessage(
      `Machine "${machine.id}" is not running.`,
      start,
    );

    if (choice === start) {
      await vscode.commands.executeCommand('apple-containers.start', machine.id);
    }
    return;
  }

  if (!machine.ipAddress) {
    vscode.window.showWarningMessage(
      `Machine "${machine.id}" has no IP address yet. Try refreshing after it starts.`,
    );
    return;
  }

  const remoteSshExtension = vscode.extensions.getExtension(REMOTE_SSH_EXTENSION_ID);
  if (!remoteSshExtension) {
    const install = 'Install Remote SSH';
    const choice = await vscode.window.showErrorMessage(
      'Remote SSH extension is required to connect.',
      install,
    );

    if (choice === install) {
      await vscode.commands.executeCommand(
        'workbench.extensions.installExtension',
        REMOTE_SSH_EXTENSION_ID,
      );
    }
    return;
  }

  if (!remoteSshExtension.isActive) {
    await remoteSshExtension.activate();
  }

  const username = await resolveSshUser(cli, machine);
  const remoteAuthority = `ssh-remote+${username}@${machine.ipAddress}`;

  await vscode.commands.executeCommand('vscode.newWindow', {
    remoteAuthority,
    reuseWindow: false,
  });
}
