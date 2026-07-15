# Apple Containers

VS Code / Cursor extension for managing **Apple container machines** (`container machine`).

## Features

- List container machines with status and IP address
- Start and stop machines from the sidebar
- Connect to a running machine via **Remote SSH**
- Auto-refresh with configurable interval
- Start the container system when it is not running

## Requirements

- macOS 26+ on Apple Silicon
- [Apple `container` CLI](https://github.com/apple/container) installed (`container` in `PATH`)
- Container system running: `container system start`
- [Remote - SSH](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-ssh) extension for SSH connections (in Cursor: `anysphere.remote-ssh`)

## Usage

1. Open the **Apple Containers** view in the Activity Bar.
2. Machines appear with `status · IP` in the description.
3. Use inline actions or the context menu:
   - **Start** — boots a stopped machine (`container machine run -n <id> -d -- true`)
   - **Stop** — stops a running machine
   - **Connect via SSH** — pick or enter a username, then open a Remote SSH window as `user@ip`
   - **Copy IP** — copy the machine IP to the clipboard
4. Click **Refresh** in the view title to update the list manually.

SSH usernames are stored in the extension global storage folder and offered again on later connects.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `appleContainers.containerPath` | `container` | Path to the Apple container CLI |
| `appleContainers.refreshInterval` | `8000` | Auto-refresh interval in ms (0 to disable) |

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

```bash
npm run package
```

Install the generated `.vsix` file:

```bash
code --install-extension apple-containers-0.1.0.vsix
cursor --install-extension apple-containers-0.1.0.vsix
```

## CLI mapping

| Action | Command |
|--------|---------|
| List | `container machine list --format json` |
| Inspect | `container machine inspect <id>` |
| Stop | `container machine stop <id>` |
| Start | `container machine run -n <id> -d -- true` |
| Start system | `container system start` |

## License

MIT
