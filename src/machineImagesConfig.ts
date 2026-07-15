import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

const USER_CONFIG_FILE = 'machine-images.json';
const BUILD_STATE_FILE = 'machine-images.state.json';
const CUSTOM_DIR = 'custom-dockerfile';
const CUSTOM_DOCKERFILE = 'Dockerfile';
const CUSTOM_LAST_TAG_FILE = 'custom-last-tag.json';

export interface MachineImageTemplate {
  id: string;
  label: string;
  description: string;
  baseImage: string;
  localTag: string;
  enabled: boolean;
}

interface MachineImagesConfig {
  templates: MachineImageTemplate[];
}

interface BuildState {
  /** template id → baseImage used for the last successful localTag build */
  builtBaseImages: Record<string, string>;
}

function isTemplate(value: unknown): value is MachineImageTemplate {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    typeof item.label === 'string' &&
    typeof item.description === 'string' &&
    typeof item.baseImage === 'string' &&
    typeof item.localTag === 'string' &&
    typeof item.enabled === 'boolean'
  );
}

function parseConfig(raw: string): MachineImagesConfig {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Config must be a JSON object');
  }
  const templates = (parsed as { templates?: unknown }).templates;
  if (!Array.isArray(templates) || templates.length === 0) {
    throw new Error('Config must include a non-empty "templates" array');
  }
  if (!templates.every(isTemplate)) {
    throw new Error(
      'Each template needs id, label, description, baseImage, localTag, enabled',
    );
  }
  return { templates };
}

export class MachineImagesConfigService {
  private readonly userConfigPath: string;
  private readonly buildStatePath: string;
  private readonly defaultsPath: string;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.userConfigPath = path.join(
      context.globalStorageUri.fsPath,
      USER_CONFIG_FILE,
    );
    this.buildStatePath = path.join(
      context.globalStorageUri.fsPath,
      BUILD_STATE_FILE,
    );
    this.defaultsPath = path.join(
      context.extensionPath,
      'templates',
      'machine-images.json',
    );
  }

  getUserConfigPath(): string {
    return this.userConfigPath;
  }

  getCustomDockerfilePath(): string {
    return path.join(
      this.context.globalStorageUri.fsPath,
      CUSTOM_DIR,
      CUSTOM_DOCKERFILE,
    );
  }

  getCustomContextPath(): string {
    return path.join(this.context.globalStorageUri.fsPath, CUSTOM_DIR);
  }

  templateContextPath(templateId: string): string {
    return path.join(this.context.extensionPath, 'templates', templateId);
  }

  /**
   * Ensure a user-owned Dockerfile exists for the Custom path.
   * Never overwrites an existing custom Dockerfile.
   */
  async ensureCustomDockerfile(): Promise<string> {
    const dockerfilePath = this.getCustomDockerfilePath();
    const contextDir = this.getCustomContextPath();
    await fs.mkdir(contextDir, { recursive: true });

    try {
      await fs.access(dockerfilePath);
    } catch {
      const skeletonPath = path.join(
        this.context.extensionPath,
        'templates',
        'custom',
        'Dockerfile.skeleton',
      );
      const skeleton = await fs.readFile(skeletonPath, 'utf8');
      await fs.writeFile(dockerfilePath, skeleton, 'utf8');
    }

    return dockerfilePath;
  }

  async openCustomDockerfile(): Promise<void> {
    const dockerfilePath = await this.ensureCustomDockerfile();
    const document = await vscode.workspace.openTextDocument(dockerfilePath);
    await vscode.window.showTextDocument(document);
  }

  async getLastCustomTag(): Promise<string> {
    try {
      const raw = await fs.readFile(
        path.join(this.context.globalStorageUri.fsPath, CUSTOM_LAST_TAG_FILE),
        'utf8',
      );
      const parsed = JSON.parse(raw) as { tag?: string };
      if (typeof parsed.tag === 'string' && parsed.tag.trim()) {
        return parsed.tag.trim();
      }
    } catch {
      // fall through
    }
    return 'edi-containers/custom:local';
  }

  async setLastCustomTag(tag: string): Promise<void> {
    await fs.mkdir(this.context.globalStorageUri.fsPath, { recursive: true });
    await fs.writeFile(
      path.join(this.context.globalStorageUri.fsPath, CUSTOM_LAST_TAG_FILE),
      `${JSON.stringify({ tag }, null, 2)}\n`,
      'utf8',
    );
  }

  /** Content fingerprint so rebuild happens when the user edits their Dockerfile. */
  async getCustomDockerfileFingerprint(): Promise<string> {
    const dockerfilePath = await this.ensureCustomDockerfile();
    const content = await fs.readFile(dockerfilePath, 'utf8');
    let hash = 0;
    for (let i = 0; i < content.length; i += 1) {
      hash = (hash * 31 + content.charCodeAt(i)) | 0;
    }
    return `custom:${content.length}:${hash}`;
  }

  async ensureUserConfig(): Promise<void> {
    await fs.mkdir(this.context.globalStorageUri.fsPath, { recursive: true });
    try {
      await fs.access(this.userConfigPath);
      await this.migrateUserConfig();
    } catch {
      const defaults = await fs.readFile(this.defaultsPath, 'utf8');
      await fs.writeFile(this.userConfigPath, defaults, 'utf8');
    }
  }

  /**
   * Drop removed presets / bump broken local tags / add new default templates.
   */
  private async migrateUserConfig(): Promise<void> {
    try {
      const raw = await fs.readFile(this.userConfigPath, 'utf8');
      const config = parseConfig(raw);
      let changed = false;

      const filtered = config.templates.filter(
        (template) => template.id !== 'arch',
      );
      if (filtered.length !== config.templates.length) {
        config.templates = filtered;
        changed = true;
      }

      for (const template of config.templates) {
        if (template.localTag.startsWith('apple-containers/')) {
          template.localTag = `edi-containers/${template.localTag.slice(
            'apple-containers/'.length,
          )}`;
          changed = true;
        }
        if (
          template.id === 'alpine' &&
          template.localTag !== 'edi-containers/alpine-ssh:v7' &&
          (template.localTag === 'edi-containers/alpine-ssh:local' ||
            template.localTag.startsWith('edi-containers/alpine-ssh:v'))
        ) {
          template.localTag = 'edi-containers/alpine-ssh:v7';
          template.description = 'Alpine + OpenRC + SSH + Node (root/root)';
          changed = true;
        }
        if (
          template.id === 'kali' &&
          template.localTag !== 'edi-containers/kali-ssh:v3'
        ) {
          template.localTag = 'edi-containers/kali-ssh:v3';
          template.description = 'Kali Rolling + systemd + SSH (root/root)';
          changed = true;
        }
      }

      const defaults = await this.loadDefaults();
      const existingIds = new Set(config.templates.map((t) => t.id));
      for (const template of defaults.templates) {
        if (!existingIds.has(template.id)) {
          config.templates.push(template);
          changed = true;
        }
      }

      if (!changed) {
        return;
      }

      if (config.templates.length === 0) {
        const defaultsRaw = await fs.readFile(this.defaultsPath, 'utf8');
        await fs.writeFile(this.userConfigPath, defaultsRaw, 'utf8');
        return;
      }

      await fs.writeFile(
        this.userConfigPath,
        `${JSON.stringify(config, null, 2)}\n`,
        'utf8',
      );
    } catch {
      // Leave broken/unreadable config for loadTemplates to handle.
    }
  }

  async loadDefaults(): Promise<MachineImagesConfig> {
    const raw = await fs.readFile(this.defaultsPath, 'utf8');
    return parseConfig(raw);
  }

  async loadTemplates(enabledOnly = true): Promise<MachineImageTemplate[]> {
    await this.ensureUserConfig();
    try {
      const raw = await fs.readFile(this.userConfigPath, 'utf8');
      const config = parseConfig(raw);
      return enabledOnly
        ? config.templates.filter((template) => template.enabled)
        : config.templates;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showWarningMessage(
        `Invalid machine-images.json (${message}). Using extension defaults.`,
      );
      const defaults = await this.loadDefaults();
      return enabledOnly
        ? defaults.templates.filter((template) => template.enabled)
        : defaults.templates;
    }
  }

  async openUserConfig(): Promise<void> {
    await this.ensureUserConfig();
    const document = await vscode.workspace.openTextDocument(
      this.userConfigPath,
    );
    await vscode.window.showTextDocument(document);
  }

  async getBuiltBaseImage(templateId: string): Promise<string | undefined> {
    const state = await this.readBuildState();
    return state.builtBaseImages[templateId];
  }

  async setBuiltBaseImage(
    templateId: string,
    baseImage: string,
  ): Promise<void> {
    const state = await this.readBuildState();
    state.builtBaseImages[templateId] = baseImage;
    await fs.mkdir(this.context.globalStorageUri.fsPath, { recursive: true });
    await fs.writeFile(
      this.buildStatePath,
      `${JSON.stringify(state, null, 2)}\n`,
      'utf8',
    );
  }

  private async readBuildState(): Promise<BuildState> {
    try {
      const raw = await fs.readFile(this.buildStatePath, 'utf8');
      const parsed = JSON.parse(raw) as BuildState;
      if (!parsed.builtBaseImages || typeof parsed.builtBaseImages !== 'object') {
        return { builtBaseImages: {} };
      }
      return parsed;
    } catch {
      return { builtBaseImages: {} };
    }
  }
}
