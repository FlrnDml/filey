import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { OllamaPullResult, OllamaStatus, Settings } from '../../../core/ipc';
import { createMockFiley, type MockFileyOptions } from '../../test/mockFiley';
import { OLLAMA_TEXT, OllamaSetup, progressText } from './OllamaSetup';

const RUNNING: OllamaStatus = { running: true, version: '0.12.3', models: ['qwen2.5vl:7b'] };

async function setup(options: MockFileyOptions = {}) {
  const mock = createMockFiley({ settings: { provider: 'ollama' }, ...options });
  const { api } = mock;
  const spies = {
    status: vi.spyOn(api.ollama, 'status'),
    pull: vi.spyOn(api.ollama, 'pull'),
    cancel: vi.spyOn(api.ollama, 'cancelPull'),
    openDownloadPage: vi.spyOn(api.ollama, 'openDownloadPage'),
    update: vi.spyOn(api.settings, 'update'),
  };
  const settings = await api.settings.get();
  const onSettings = vi.fn<(s: Settings) => void>();
  const user = userEvent.setup();
  render(<OllamaSetup api={api} settings={settings} onSettings={onSettings} />);
  return { ...mock, spies, user, onSettings };
}

const modelField = () => screen.getByLabelText('Model');

describe('OllamaSetup', () => {
  it('says Ollama is running with its version and that the model is installed', async () => {
    await setup({ ollamaStatus: RUNNING });
    expect(await screen.findByText(/Ollama 0.12.3 is running/)).toBeInTheDocument();
    expect(screen.getByText(OLLAMA_TEXT.installed)).toBeInTheDocument();
    expect(modelField()).toHaveValue('qwen2.5vl:7b');
    expect(screen.queryByRole('button', { name: OLLAMA_TEXT.download })).not.toBeInTheDocument();
  });

  it('looks for Ollama first', async () => {
    await setup();
    expect(screen.getByText(OLLAMA_TEXT.checking)).toBeInTheDocument();
    await screen.findByText(/is running/);
  });

  it('offers the download page when Ollama is not running, and no model download', async () => {
    const { user, spies } = await setup({ ollamaStatus: { running: false, models: [] } });
    expect(await screen.findByText(OLLAMA_TEXT.notRunning)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: OLLAMA_TEXT.download })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: OLLAMA_TEXT.getOllama }));
    expect(spies.openDownloadPage).toHaveBeenCalledOnce();
  });

  it('treats a status that cannot be read as not running', async () => {
    const mock = createMockFiley({ settings: { provider: 'ollama' } });
    vi.spyOn(mock.api.ollama, 'status').mockRejectedValue(new Error('boom'));
    render(<OllamaSetup api={mock.api} settings={await mock.api.settings.get()} onSettings={() => undefined} />);
    expect(await screen.findByText(OLLAMA_TEXT.notRunning)).toBeInTheDocument();
  });

  it('offers to download a model that is not installed yet, and refreshes when it is done', async () => {
    let installed = false;
    const mock = createMockFiley({ settings: { provider: 'ollama' }, pullModel: async () => ((installed = true), { ok: true }) });
    vi.spyOn(mock.api.ollama, 'status').mockImplementation(async () => ({ running: true, models: installed ? ['qwen2.5vl:7b'] : [] }));
    const pull = vi.spyOn(mock.api.ollama, 'pull');
    const user = userEvent.setup();
    render(<OllamaSetup api={mock.api} settings={await mock.api.settings.get()} onSettings={() => undefined} />);

    expect(await screen.findByText(OLLAMA_TEXT.notInstalled)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: OLLAMA_TEXT.download }));
    expect(pull).toHaveBeenCalledExactlyOnceWith('qwen2.5vl:7b');
    expect(await screen.findByText(OLLAMA_TEXT.downloaded)).toBeInTheDocument();
    expect(await screen.findByText(OLLAMA_TEXT.installed)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: OLLAMA_TEXT.download })).not.toBeInTheDocument();
  });

  it('shows the progress while downloading and lets the user cancel', async () => {
    let finish: (result: OllamaPullResult) => void = () => undefined;
    const { user, spies, emit } = await setup({
      ollamaStatus: { running: true, models: [] },
      pullModel: () => new Promise((resolve) => (finish = resolve)),
    });
    await user.click(await screen.findByRole('button', { name: OLLAMA_TEXT.download }));
    expect(screen.getByRole('progressbar', { name: 'Model download' })).toBeInTheDocument();
    expect(screen.getByText('Starting the download…')).toBeInTheDocument();
    expect(modelField()).toBeDisabled();

    act(() => emit('ollama:pull-progress', { model: 'qwen2.5vl:7b', status: 'pulling abc', completed: 35, total: 100 }));
    expect(screen.getByText('Downloading… 35 %')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Model download' })).toHaveValue(35);

    await user.click(screen.getByRole('button', { name: OLLAMA_TEXT.cancel }));
    expect(spies.cancel).toHaveBeenCalledOnce();
    await act(async () => finish({ ok: false, reason: 'cancelled', message: 'The download was cancelled.' }));
    expect(await screen.findByText('The download was cancelled.')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: OLLAMA_TEXT.download })).toBeEnabled();
  });

  it('shows why a download failed', async () => {
    const { user } = await setup({
      ollamaStatus: { running: true, models: [] },
      pullModel: async () => ({ ok: false, reason: 'failed', message: 'The model could not be downloaded.' }),
    });
    await user.click(await screen.findByRole('button', { name: OLLAMA_TEXT.download }));
    expect(await screen.findByText('The model could not be downloaded.')).toBeInTheDocument();
  });

  it('shows a download that could not even be started', async () => {
    const { user, spies } = await setup({ ollamaStatus: { running: true, models: [] } });
    spies.pull.mockRejectedValueOnce(new Error('ipc'));
    await user.click(await screen.findByRole('button', { name: OLLAMA_TEXT.download }));
    expect(await screen.findByText('Filey could not download the model.')).toBeInTheDocument();
  });

  it('saves a typed model when the field is left, and downloads exactly that model', async () => {
    const { user, spies, onSettings } = await setup({ ollamaStatus: { running: true, models: [] } });
    await screen.findByText(OLLAMA_TEXT.notInstalled);
    await user.clear(modelField());
    await user.type(modelField(), 'gemma3:4b');
    await user.click(screen.getByRole('button', { name: OLLAMA_TEXT.download }));
    expect(spies.update).toHaveBeenCalledWith({ ollamaModel: 'gemma3:4b' });
    await waitFor(() => expect(spies.pull).toHaveBeenCalledWith('gemma3:4b'));
    expect(onSettings).toHaveBeenCalledWith(expect.objectContaining({ ollamaModel: 'gemma3:4b' }));
  });

  it('falls back to the recommended model for an empty field', async () => {
    const { user, spies } = await setup({ settings: { provider: 'ollama', ollamaModel: 'gemma3:4b' } });
    await screen.findByText(/is running/);
    await user.clear(modelField());
    await user.keyboard('{Enter}');
    expect(spies.update).toHaveBeenCalledExactlyOnceWith({ ollamaModel: 'qwen2.5vl:7b' });
  });

  it('shows the reason when a model name is refused and keeps what was typed', async () => {
    const { user } = await setup({ rejectUpdate: () => ({ message: 'Enter an Ollama model name such as qwen2.5vl:7b.', field: 'ollamaModel' }) });
    await screen.findByText(/is running/);
    await user.clear(modelField());
    await user.type(modelField(), 'two words{Enter}');
    expect(await screen.findByText('Enter an Ollama model name such as qwen2.5vl:7b.')).toBeInTheDocument();
    expect(modelField()).toHaveValue('two words');
  });

  it('puts the saved model back on Escape', async () => {
    const { user, spies } = await setup();
    await screen.findByText(/is running/);
    await user.type(modelField(), 'x');
    await user.keyboard('{Escape}');
    expect(modelField()).toHaveValue('qwen2.5vl:7b');
    expect(spies.update).not.toHaveBeenCalled();
  });

  it('looks again when the window gets focus, for example after starting Ollama', async () => {
    const { spies } = await setup({ ollamaStatus: { running: false, models: [] } });
    await screen.findByText(OLLAMA_TEXT.notRunning);
    expect(spies.status).toHaveBeenCalledTimes(1);
    act(() => void window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(spies.status).toHaveBeenCalledTimes(2));
  });
});

describe('progressText', () => {
  it('shows a percentage for a step with a size, capped at 100 %', () => {
    expect(progressText({ model: 'm', status: 's', completed: 1, total: 3 })).toBe('Downloading… 33 %');
    expect(progressText({ model: 'm', status: 's', completed: 5, total: 3 })).toBe('Downloading… 100 %');
  });

  it('shows plain steps without a size', () => {
    expect(progressText(null)).toBe('Starting the download…');
    expect(progressText({ model: 'm', status: 'pulling manifest' })).toBe('Preparing the download…');
    expect(progressText({ model: 'm', status: 'success' })).toBe('Finishing…');
    expect(progressText({ model: 'm', status: 's', completed: 0, total: 0 })).toBe('Preparing the download…');
  });
});
