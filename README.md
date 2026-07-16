# ediContainers

VS Code / Cursor extension for managing **Apple container machines** (`container machine`).

## Features

- Create machines from presets (Ubuntu, Debian, Alpine, Kali) with SSH + sudo preconfigured (`root` / `root`)
- **Custom Dockerfile** path for hand-written images (does not touch preset Dockerfiles / BASE_IMAGE injection)
- Edit which base images/versions to pull via a user JSON settings file
- List container machines with status and IP address
- Start, stop, and delete machines from the sidebar
- Connect to a running machine via **Remote SSH**
- Auto-refresh with configurable interval
- Start the container system when it is not running

## Requirements

- macOS 26+ on Apple Silicon
- [Apple `container` CLI](https://github.com/apple/container) installed (`container` in `PATH`)
- Container system running: `container system start`
- [Remote - SSH](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-ssh) extension for SSH connections (in Cursor: `anysphere.remote-ssh`)

## Installation

Prebuilt `.vsix` releases are published on GitHub — no `npm` / compile required.

1. Open [Releases](https://github.com/tunerok/apple-containers/releases) and download `edi-containers-*.vsix` (e.g. `edi-containers-0.2.0.vsix`).
2. Install in one of these ways:

**Cursor / VS Code UI**

1. Open Extensions (`Cmd+Shift+X`).
2. Click `…` (top of the Extensions view) → **Install from VSIX…**
3. Select the downloaded `.vsix` file.
4. Reload the window if prompted.

**CLI**

```bash
# Cursor
cursor --install-extension ~/Downloads/edi-containers-0.2.0.vsix

# VS Code
code --install-extension ~/Downloads/edi-containers-0.2.0.vsix
```

Or download the asset from the latest release, then install the local file (CLI cannot resolve a version-agnostic `.vsix` name automatically):

```bash
# open latest release in browser, download edi-containers-*.vsix, then:
cursor --install-extension ~/Downloads/edi-containers-0.2.0.vsix
```

After install, open the **ediContainers** icon in the Activity Bar.

## Usage

1. Open the **ediContainers** view in the Activity Bar.
2. Click **+** (**Create Machine**): pick a preset **or Custom Dockerfile**, enter a name. Presets build with injected `BASE_IMAGE`; Custom builds your file as-is.
3. Machines appear with `status · IP` in the description.
4. Use inline actions or the context menu:
   - **Start** — boots a stopped machine
   - **Stop** — stops a running machine
   - **Connect via SSH** — pick or enter a username, then open a Remote SSH window as `user@ip` (preset machines: `root` / `root`)
   - **Copy IP** — copy the machine IP to the clipboard
   - **Delete Machine** — stop (if needed) and delete
5. Click the gear (**Edit Machine Image Settings**) to change preset base image tags/versions. Use **Edit Custom Dockerfile** (or the Custom item in Create) for a fully manual image.
6. Click **Refresh** to update the list manually.

### Custom Dockerfile

Presets stay opinionated (SSH `root`/`root`, systemd/OpenRC, etc.). For full control:

1. **Create Machine → Custom Dockerfile** (or command **Edit Custom Dockerfile**).
2. Edit the file in extension global storage (created once from a minimal skeleton; never overwritten).
3. **Build & Create** → choose image tag → machine name.

No `--build-arg BASE_IMAGE` is passed. Rebuild triggers when the Dockerfile content changes.

SSH usernames are stored in the extension global storage folder and offered again on later connects.

### Machine image settings

Defaults ship in `templates/machine-images.json`. On first use a copy is written to the extension global storage. Edit that copy (via the gear command) to change what gets pulled, for example:

```json
{
  "id": "ubuntu",
  "label": "Ubuntu",
  "description": "Ubuntu + systemd + SSH (root/root)",
  "baseImage": "ubuntu:22.04",
  "localTag": "edi-containers/ubuntu-ssh:local",
  "enabled": true
}
```

Set `"enabled": false` to hide a template from Create. After changing `baseImage`, the next Create rebuilds that local tag.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `ediContainers.containerPath` | `container` | Path to the Apple container CLI |
| `ediContainers.refreshInterval` | `8000` | Auto-refresh interval in ms (0 to disable) |

## Development

```bash
npm install
npm run compile
npm run watch   # during development
```

If Node.js/npm is not installed globally, you can compile with Cursor's bundled Node:

```bash
npm run compile:cursor
```

Or manually:

```bash
export PATH="/Applications/Cursor.app/Contents/Resources/app/resources/helpers:$PATH"
node esbuild.js
```

Press **F5** in VS Code/Cursor to launch an Extension Development Host.

## Build VSIX

For maintainers (end users should use [Installation](#installation) from Releases):

```bash
npm install
npm run package
```

This produces `edi-containers-<version>.vsix` in the repo root. Attach it to a GitHub Release for others to install.

## CLI mapping

| Action | Command |
|--------|---------|
| List | `container machine list --format json` |
| Inspect | `container machine inspect <id>` |
| Stop | `container machine stop <id>` |
| Start | `container machine run -n <id> -d -- true` |
| Create | `container machine create <image> --name <name>` |
| Delete | `container machine delete <id>` |
| Build template | `container build --tag <tag> --build-arg BASE_IMAGE=… <templateDir>` |
| Start system | `container system start` |

## License

MIT
