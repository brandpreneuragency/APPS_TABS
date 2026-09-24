# TABS

Local-first writing, tasks, CRM, forms, and an integrated assistant. Built with React, TipTap, and Tauri.

**Primary runtime:** Windows desktop via Tauri. User documents, tasks, CRM data, settings, and personas stay on the machine. The assistant uses the locally installed Codex CLI with ChatGPT sign-in. There is no hosted TABS web app, VPS backend, Hermes gateway, or remote filesystem.

Vite/browser mode is a development preview only, not a supported production runtime.

## Features

- Document workspaces with rich text editing and local folder access
- Task manager, subtasks, projects, CRM, and forms
- Codex assistant sidebar with captured workspace context and approved business actions
- Local personas, instructions, reusable prompts, and chat history
- Local terminal, DOCX/PDF/TXT export, English and Turkish UI, and Tauri updater

## Getting started

### Windows desktop

```bash
npm install
npm run tauri:dev
```

Install the Codex CLI and sign in to it with your ChatGPT account. Open **Settings > Tools** in TABS to see the CLI connection, available models, and reasoning choices. TABS does not ask for an API key. Documents, tasks, CRM, forms, and the terminal remain usable when Codex is unavailable.

Older direct-API chats remain readable. Start a new Codex chat and use the explicit handoff action to carry selected history forward.

### Browser development preview

```bash
npm run dev
```

Open [http://localhost:1421](http://localhost:1421). Folder access uses the browser File System Access API where available. Codex chat, the native terminal, and full desktop features require Tauri.

### Production package

```bash
npm run tauri:build
```

## Architecture

- React feature components use `src/services/runtime.ts`, `fs-adapter.ts`, and folder connectors instead of importing Tauri directly.
- Tauri uses `TauriFolderConnector`; the browser preview uses `BrowserFolderConnector`.
- Dexie stores application state. Local disk stores documents opened from folders.
- Rust owns the launched Codex process. The app-lifetime session service owns chat queueing, recovery, and approved business requests.

See [AGENTS.md](./AGENTS.md) for repository rules and verification commands.
