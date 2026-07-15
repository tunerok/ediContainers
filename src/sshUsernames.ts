import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

const STORAGE_FILE = 'ssh-usernames.json';

export class SshUsernameStore {
  private readonly filePath: string;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.filePath = path.join(context.globalStorageUri.fsPath, STORAGE_FILE);
  }

  async list(): Promise<string[]> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        return [];
      }
      return [];
    }
  }

  async remember(username: string): Promise<void> {
    const normalized = username.trim();
    if (!normalized) {
      return;
    }

    const existing = await this.list();
    const next = [
      normalized,
      ...existing.filter((value) => value !== normalized),
    ];

    await fs.mkdir(this.context.globalStorageUri.fsPath, { recursive: true });
    await fs.writeFile(
      this.filePath,
      `${JSON.stringify(next, null, 2)}\n`,
      'utf8',
    );
  }
}

const ENTER_NEW_LABEL = 'Enter new username…';

export async function promptSshUsername(
  store: SshUsernameStore,
  suggested?: string,
): Promise<string | undefined> {
  const saved = await store.list();
  const items: vscode.QuickPickItem[] = [];

  if (suggested && !saved.includes(suggested)) {
    items.push({
      label: suggested,
      description: 'from machine',
    });
  }

  for (const username of saved) {
    items.push({
      label: username,
      description: username === suggested ? 'from machine' : 'saved',
    });
  }

  items.push({
    label: ENTER_NEW_LABEL,
    alwaysShow: true,
  });

  const selected = await vscode.window.showQuickPick(items, {
    title: 'SSH username',
    placeHolder: 'Select a username or enter a new one',
    matchOnDescription: true,
  });

  if (!selected) {
    return undefined;
  }

  let username: string | undefined;
  if (selected.label === ENTER_NEW_LABEL) {
    username = await vscode.window.showInputBox({
      title: 'SSH username',
      prompt: 'Username for Remote SSH (before @)',
      value: suggested ?? '',
      placeHolder: 'e.g. artem',
      validateInput: (value) => {
        const trimmed = value.trim();
        if (!trimmed) {
          return 'Username cannot be empty';
        }
        if (/\s/.test(trimmed) || trimmed.includes('@')) {
          return 'Username must not contain spaces or @';
        }
        return undefined;
      },
    });
  } else {
    username = selected.label;
  }

  if (!username) {
    return undefined;
  }

  const trimmed = username.trim();
  await store.remember(trimmed);
  return trimmed;
}
