import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { LocalModel, ModelProvider } from '../providers/modelProvider';
import { isWebviewMessage } from './webviewMessages';

export class ModelCenterViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private installController?: AbortController;
  private activeInstallName?: string;
  private pausedInstallName?: string;
  private installStatus?: Record<string, unknown>;

  constructor(private readonly provider: ModelProvider, private readonly onModelsChanged?: () => Promise<void>) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.html = this.getHtml(view.webview);
    const messages = view.webview.onDidReceiveMessage(async (raw: unknown) => {
      if (this.view !== view || !isWebviewMessage(raw)) return;
      if (raw.type === 'ready' || raw.type === 'refresh') {
        await this.refresh();
        if (this.installStatus) this.post(this.installStatus);
      }
      if (raw.type === 'installModel') await this.install(raw.model);
      if (raw.type === 'pauseModelInstall') this.pauseInstall();
      if (raw.type === 'cancelModelInstall') this.cancelInstall();
      if (raw.type === 'deleteModel') await this.delete(raw.modelId);
      if (raw.type === 'setDefaultModel') await this.setDefault(raw.modelId);
      if (raw.type === 'selectModel') await this.select(raw.model);
    });
    view.onDidDispose(() => {
      messages.dispose();
      if (this.view === view) this.view = undefined;
    });
  }

  dispose(): void {
    this.pausedInstallName = undefined;
    this.installController?.abort();
    this.view = undefined;
  }

  private updateInstallStatus(message: Record<string, unknown>): void {
    this.installStatus = { ...message, type: 'modelCenterStatus' };
    this.post(this.installStatus);
  }

  private notice(state: 'complete' | 'error', message: string): void {
    this.post({ type: 'modelCenterNotice', state, message });
  }

  private async select(modelId: string): Promise<void> {
    try {
      const model = (await this.provider.listModels()).find((item) => item.id === modelId || item.name === modelId);
      if (!model) throw new Error('That model is no longer available. Refresh and try again.');
      await this.onModelsChanged?.();
      await vscode.commands.executeCommand('localforge.setModel', model.id || model.name);
      await vscode.commands.executeCommand('localforge.chatView.focus');
      this.notice('complete', `${model.displayName || model.name} selected for chat.`);
    } catch (error) {
      this.notice('error', error instanceof Error ? error.message : String(error));
    }
  }

  private async refresh(): Promise<void> {
    try {
      const models = await this.provider.listModels();
      const defaultModel = vscode.workspace.getConfiguration('localforge.routing').get<string>('agentModel', '');
      this.post({ type: 'models', models, defaultModel });
      if (models.length || await this.provider.detect()) {
        this.notice('complete', '');
      } else {
        this.notice('error', 'No model providers are reachable. Start Ollama or check your configured endpoint, then refresh.');
      }
    } catch (error) {
      this.notice('error', error instanceof Error ? error.message : String(error));
    }
  }

  private async install(name: string): Promise<void> {
    const normalizedName = name.trim();
    if (this.installController) {
      this.notice('error', 'A model download is already running.');
      return;
    }
    if (this.pausedInstallName && this.pausedInstallName !== normalizedName) {
      this.notice('error', `Resume or cancel the paused download for ${this.pausedInstallName} first.`);
      return;
    }
    if (!this.provider.pullModel) {
      this.updateInstallStatus({ state: 'error', message: 'The configured model provider does not support downloads.' });
      return;
    }

    const resuming = this.pausedInstallName === normalizedName;
    this.pausedInstallName = undefined;
    const controller = new AbortController();
    this.installController = controller;
    this.activeInstallName = normalizedName;
    this.updateInstallStatus({ state: 'progress', model: normalizedName, progress: { status: resuming ? 'Restarting pull; Ollama may reuse completed layers' : 'Starting download' } });
    let result: Record<string, unknown>;
    try {
      await this.provider.pullModel(normalizedName, (progress) => {
        if (!controller.signal.aborted) this.updateInstallStatus({ state: 'progress', model: normalizedName, progress });
      }, controller.signal);
      controller.signal.throwIfAborted();
      await this.onModelsChanged?.();
      await this.refresh();
      controller.signal.throwIfAborted();
      result = { state: 'complete', model: normalizedName, message: `Ollama confirmed the download of ${normalizedName}.` };
    } catch (error) {
      const cancelled = controller.signal.aborted;
      const paused = cancelled && this.pausedInstallName === normalizedName;
      result = {
        state: paused ? 'paused' : cancelled ? 'cancelled' : 'error',
        model: normalizedName,
        message: paused ? `Paused ${normalizedName}. Select Resume download to continue.` : cancelled ? 'Model download cancelled.' : error instanceof Error ? error.message : String(error)
      };
    } finally {
      if (this.installController === controller) {
        this.installController = undefined;
        this.activeInstallName = undefined;
      }
    }
    this.updateInstallStatus(result);
  }

  private pauseInstall(): void {
    if (!this.installController || !this.activeInstallName) return;
    this.pausedInstallName = this.activeInstallName;
    this.installController.abort();
  }

  private cancelInstall(): void {
    if (this.installController) {
      this.pausedInstallName = undefined;
      this.installController.abort();
      return;
    }
    if (this.pausedInstallName) {
      this.pausedInstallName = undefined;
      this.updateInstallStatus({ state: 'cancelled', message: 'Paused download discarded. Ollama may retain already downloaded layers.' });
    }
  }

  private async delete(modelId: string): Promise<void> {
    if (this.installController || this.pausedInstallName) {
      this.notice('error', 'Finish or cancel the model download before deleting an installed model.');
      return;
    }
    if (!this.provider.deleteModel) {
      this.notice('error', 'This provider cannot delete models.');
      return;
    }
    let models: LocalModel[];
    try {
      models = await this.provider.listModels();
    } catch (error) {
      this.notice('error', error instanceof Error ? error.message : String(error));
      return;
    }
    const model = models.find((item) => item.id === modelId || item.name === modelId);
    if (!model || model.providerId !== 'ollama' || model.source === 'remote') {
      this.notice('error', 'Only an installed local Ollama model can be deleted here.');
      return;
    }
    const confirmed = await vscode.window.showWarningMessage(
      `Delete local model “${model.displayName || model.name}”? Its downloaded files will be removed and can be downloaded again later.`,
      { modal: true },
      'Delete Model'
    );
    if (confirmed !== 'Delete Model') return;

    try {
      await this.provider.deleteModel(modelId);
      await this.onModelsChanged?.();
      await this.refresh();
      this.notice('complete', `${model.displayName || model.name} was removed.`);
    } catch (error) {
      this.notice('error', error instanceof Error ? error.message : String(error));
    }
  }

  private async setDefault(modelId: string): Promise<void> {
    try {
      const model = (await this.provider.listModels()).find((item) => item.id === modelId || item.name === modelId);
      if (!model) {
        this.notice('error', 'That model is no longer installed. Refresh and try again.');
        return;
      }
      await this.onModelsChanged?.();
      const configuration = vscode.workspace.getConfiguration('localforge.routing');
      await Promise.all([
        configuration.update('agentModel', modelId, vscode.ConfigurationTarget.Global),
        configuration.update('chatModel', modelId, vscode.ConfigurationTarget.Global)
      ]);
      await vscode.commands.executeCommand('localforge.setModel', modelId);
      await this.refresh();
      this.notice('complete', `${model.displayName || model.name} is now the default chat and agent model.`);
    } catch (error) {
      this.notice('error', error instanceof Error ? error.message : String(error));
    }
  }

  private post(message: Record<string, unknown>): void {
    void this.view?.webview.postMessage(message);
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = randomBytes(18).toString('base64');
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  :root { color-scheme: light dark; }
  body { color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font: 12px var(--vscode-font-family); margin: 0; padding: 12px; }
  * { box-sizing: border-box; }
  header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  h1 { font-size: 14px; font-weight: 600; margin: 0; }
  button, input { font: inherit; color: var(--vscode-foreground); }
  button { border: 1px solid var(--vscode-button-border, transparent); border-radius: 3px; padding: 5px 8px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); cursor: pointer; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: transparent; border-color: var(--vscode-panel-border); color: var(--vscode-foreground); }
  button.danger { color: var(--vscode-errorForeground); }
  button:disabled { opacity: .55; cursor: default; }
  .section { border-top: 1px solid var(--vscode-panel-border); padding: 12px 0; }
  .section-title { font-weight: 600; margin-bottom: 8px; }
  .install-row { display: flex; gap: 6px; }
  input { min-width: 0; flex: 1; padding: 6px 8px; border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 3px; background: var(--vscode-input-background); }
  .actions { display: flex; gap: 6px; margin-top: 7px; }
  #status, #notice { min-height: 16px; margin-top: 7px; color: var(--vscode-descriptionForeground); overflow-wrap: anywhere; }
  #notice.error { color: var(--vscode-errorForeground); }
  progress { width: 100%; height: 4px; margin-top: 6px; accent-color: var(--vscode-focusBorder); }
  #models { display: grid; gap: 7px; }
  .model { border-bottom: 1px solid var(--vscode-panel-border); padding: 8px 0 10px; }
  .model-head { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
  .model-name { font-weight: 600; overflow-wrap: anywhere; }
  .badge { color: var(--vscode-descriptionForeground); font-size: 10px; white-space: nowrap; }
  .meta { color: var(--vscode-descriptionForeground); margin-top: 4px; line-height: 1.45; overflow-wrap: anywhere; }
  .model-actions { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 7px; }
  .empty { color: var(--vscode-descriptionForeground); padding: 10px 0; }
</style>
</head>
<body>
  <header><h1>Models</h1><button id="refresh" class="secondary" type="button">Refresh</button></header>
  <div id="notice" role="status" aria-live="polite" hidden></div>
  <section class="section">
    <div class="section-title">Install from Ollama</div>
    <div class="install-row">
      <input id="modelName" maxlength="128" list="suggestions" placeholder="Model name, e.g. qwen2.5-coder:7b" aria-label="Ollama model name">
      <datalist id="suggestions"><option value="qwen2.5-coder:1.5b"><option value="qwen2.5-coder:7b"><option value="deepseek-r1:8b"><option value="llama3.2:3b"></datalist>
      <button id="install" type="button">Install</button>
    </div>
    <div class="actions"><button id="pause" class="secondary" type="button" hidden>Pause download</button><button id="cancel" class="secondary" type="button" hidden>Cancel download</button></div>
    <div id="status" role="status" aria-live="polite">Downloads use your configured local Ollama service.</div>
    <progress id="progress" max="100" value="0" hidden></progress>
  </section>
  <section class="section">
    <div class="section-title">Installed</div>
    <input id="search" type="search" placeholder="Search installed models" aria-label="Search installed models">
    <div id="models" aria-live="polite"></div>
  </section>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const modelName = document.getElementById('modelName');
  const installButton = document.getElementById('install');
  const pauseButton = document.getElementById('pause');
  const cancelButton = document.getElementById('cancel');
  const status = document.getElementById('status');
  const notice = document.getElementById('notice');
  const progress = document.getElementById('progress');
  const modelsRoot = document.getElementById('models');
  const search = document.getElementById('search');
  let models = [];
  let defaultModel = '';
  let pausedModelName = '';
  document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
  const install = () => {
    const name = modelName.value.trim();
    if (!name || name.length > 128 || /[\u0000-\u001f\u007f]/.test(name)) { status.textContent = 'Enter a valid model name (up to 128 characters).'; return; }
    if (pausedModelName && pausedModelName !== name) { status.textContent = 'Resume or discard the paused download for ' + pausedModelName + ' first.'; return; }
    installButton.disabled = true;
    modelName.disabled = true;
    installButton.textContent = 'Installing…';
    pauseButton.hidden = false;
    pauseButton.disabled = false;
    cancelButton.hidden = false;
    cancelButton.textContent = 'Cancel download';
    cancelButton.disabled = false;
    progress.hidden = false;
    progress.removeAttribute('value');
    status.textContent = 'Connecting to Ollama…';
    vscode.postMessage({ type: 'installModel', model: name });
  };
  installButton.addEventListener('click', install);
  modelName.addEventListener('keydown', event => { if (event.key === 'Enter' && !installButton.disabled) install(); });
  pauseButton.addEventListener('click', () => { pauseButton.disabled = true; cancelButton.disabled = true; status.textContent = 'Pausing…'; vscode.postMessage({ type: 'pauseModelInstall' }); });
  cancelButton.addEventListener('click', () => {
    cancelButton.disabled = true; pauseButton.disabled = true;
    status.textContent = pausedModelName ? 'Discarding paused download…' : 'Cancelling…';
    vscode.postMessage({ type: 'cancelModelInstall' });
  });
  search.addEventListener('input', renderModels);
  function formatBytes(value) {
    if (!Number.isFinite(value) || value < 0) return 'Size unavailable';
    const units = ['B', 'KB', 'MB', 'GB', 'TB']; let amount = value; let unit = 0;
    while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit += 1; }
    return amount.toFixed(unit && amount < 10 ? 1 : 0) + ' ' + units[unit];
  }
  function renderModels() {
    modelsRoot.replaceChildren();
    const query = search.value.trim().toLowerCase();
    const filtered = models.filter(model => String(model.displayName || model.name).toLowerCase().includes(query) || String(model.providerId || '').toLowerCase().includes(query));
    if (!filtered.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = query ? 'No models match this search.' : 'No models detected. Start Ollama and install a model above.'; modelsRoot.appendChild(empty); return; }
    for (const model of filtered) {
      const id = model.id || model.name;
      const card = document.createElement('article'); card.className = 'model';
      const head = document.createElement('div'); head.className = 'model-head';
      const name = document.createElement('div'); name.className = 'model-name'; name.textContent = model.displayName || model.name;
      const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = model.source === 'remote' ? 'Remote' : 'Local';
      head.append(name, badge);
      const meta = document.createElement('div'); meta.className = 'meta';
      const capabilities = model.capabilities ? Object.entries(model.capabilities).filter(([, enabled]) => enabled).map(([key]) => key).join(' · ') : '';
      meta.textContent = [model.providerId || 'Provider unavailable', formatBytes(model.size), capabilities].filter(Boolean).join(' · ');
      const actions = document.createElement('div'); actions.className = 'model-actions';
      const useButton = document.createElement('button'); useButton.className = 'secondary'; useButton.textContent = 'Use in chat';
      useButton.addEventListener('click', () => vscode.postMessage({ type: 'selectModel', model: id }));
      actions.appendChild(useButton);
      const defaultButton = document.createElement('button'); defaultButton.className = 'secondary'; defaultButton.textContent = id === defaultModel ? 'Default for chat + agent' : 'Set as default';
      defaultButton.disabled = id === defaultModel;
      defaultButton.addEventListener('click', () => vscode.postMessage({ type: 'setDefaultModel', modelId: id }));
      actions.appendChild(defaultButton);
      if (model.providerId === 'ollama' && model.source !== 'remote') {
        const deleteButton = document.createElement('button'); deleteButton.className = 'secondary danger'; deleteButton.textContent = 'Delete';
        deleteButton.addEventListener('click', () => vscode.postMessage({ type: 'deleteModel', modelId: id }));
        actions.appendChild(deleteButton);
      }
      card.append(head, meta, actions); modelsRoot.appendChild(card);
    }
  }
  window.addEventListener('message', event => {
    const message = event.data;
    if (message.type === 'models') { models = message.models || []; defaultModel = message.defaultModel || ''; renderModels(); }
    if (message.type === 'modelCenterNotice') {
      notice.textContent = message.message || '';
      notice.className = message.state === 'error' ? 'error' : '';
      notice.hidden = !notice.textContent;
    }
    if (message.type === 'modelCenterStatus') {
      const active = message.state === 'progress';
      installButton.disabled = active;
      modelName.disabled = active || message.state === 'paused';
      installButton.textContent = pausedModelName ? 'Resume download' : 'Install';
      pauseButton.hidden = !active;
      pauseButton.disabled = false;
      cancelButton.hidden = !(active || message.state === 'paused');
      cancelButton.textContent = message.state === 'paused' ? 'Discard paused download' : 'Cancel download';
      cancelButton.disabled = false;
      progress.hidden = !active;
      if (active) {
        const activeModelName = String(message.model || modelName.value.trim());
        if (pausedModelName === activeModelName) pausedModelName = '';
        modelName.value = activeModelName;
        installButton.textContent = 'Installing…';
        const item = message.progress || {};
        if (Number.isFinite(item.total) && item.total > 0 && Number.isFinite(item.completed)) {
          progress.value = Math.max(0, Math.min(100, Math.round(item.completed / item.total * 100)));
          status.textContent = (item.status || 'Downloading') + ' · ' + formatBytes(item.completed) + ' / ' + formatBytes(item.total);
        } else { progress.removeAttribute('value'); status.textContent = item.status || 'Downloading…'; }
      } else if (message.state === 'paused') {
        pausedModelName = String(message.model || modelName.value.trim());
        modelName.value = pausedModelName;
        installButton.disabled = false;
        installButton.textContent = 'Resume download';
        progress.hidden = true;
        status.textContent = (message.message || 'Download paused.') + ' Ollama may reuse completed layers when restarted.';
      } else {
        pauseButton.hidden = true;
        status.textContent = message.message || 'Done.';
        if (message.state === 'complete' || message.state === 'cancelled') {
          pausedModelName = '';
          installButton.textContent = 'Install';
          if (message.state === 'complete') { modelName.value = ''; progress.value = 100; }
        }
        if (message.state === 'complete' || message.state === 'cancelled' || message.state === 'error') cancelButton.hidden = true;
      }
    }
  });
  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }
}
