# LocalForge

LocalForge is a VS Code extension for discovering locally installed Ollama models and chatting with them from a sidebar. The first release uses an extensible `ModelProvider` interface so other local or remote runtimes can be added without changing the chat UI.

## Features

- Detects an Ollama server at `http://127.0.0.1:11434` on activation.
- Lists installed Ollama models and lets you choose one in the sidebar.
- Streams local chat responses into the conversation.
- Includes selected code, or the active file when there is no selection, when context is enabled.
- Reports unavailable Ollama servers, empty model libraries, and request errors in the sidebar.
- Supports a custom Ollama URL through the `localforge.ollama.baseUrl` setting.

The default Ollama address is loopback. If you change it to another host, prompts and enabled editor context are sent to that configured Ollama server.

## Build

```sh
npm install
npm test
npm run compile
npm run package
```

The generated `.vsix` can be installed with **Extensions: Install from VSIX...** in VS Code or `code --install-extension <file.vsix>`.

## Current scope

This first vertical slice focuses on model discovery and local chat. Remote SSH/GPU execution, edits and diffs, agent tools, retrieval, autocomplete, and model routing are extension points for later releases.

## Publishing notes

The `publisher` value in `package.json` must match a Visual Studio Marketplace publisher account you control before publishing. Choose and add a license before presenting the source as open source.
