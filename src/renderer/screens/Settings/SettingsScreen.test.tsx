import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ConnectionTestReason, SettingsTab } from '../../../core/ipc';
import { FIXTURE_NOW } from '../../test/fixtures';
import { createMockFiley, MOCK_NAME_CHECK, MOCK_RULES, type MockFileyOptions } from '../../test/mockFiley';
import { SettingsScreen } from './SettingsScreen';

const ICLOUD = '/Users/me/Library/Mobile Documents/com~apple~CloudDocs';

async function setup(tab: SettingsTab, options: MockFileyOptions = {}) {
  const mock = createMockFiley(options);
  const { api } = mock;
  const spies = {
    update: vi.spyOn(api.settings, 'update'),
    saveRules: vi.spyOn(api.settings, 'saveRules'),
    saveKey: vi.spyOn(api.apiKey, 'save'),
    clearKey: vi.spyOn(api.apiKey, 'clear'),
    test: vi.spyOn(api.connection, 'test'),
    chooseFolder: vi.spyOn(api.dialogs, 'chooseFolder'),
    setLoginItem: vi.spyOn(api.app, 'setLoginItem'),
    openLogs: vi.spyOn(api.app, 'openLogs'),
  };
  const user = userEvent.setup();
  render(<SettingsScreen initialTab={tab} api={api} now={() => FIXTURE_NOW} syncHash={false} />);
  await screen.findByRole('tabpanel');
  await waitFor(() => expect(screen.queryByText('Loading settings…')).not.toBeInTheDocument());
  return { ...mock, spies, user };
}

describe('Settings: General', () => {
  it('shows and changes "Start at login"', async () => {
    const { user, spies } = await setup('general');
    const checkbox = screen.getByRole('checkbox', { name: 'Start at login' });
    await waitFor(() => expect(checkbox).toBeChecked());

    await user.click(checkbox);
    expect(spies.setLoginItem).toHaveBeenCalledExactlyOnceWith(false);
    await waitFor(() => expect(checkbox).not.toBeChecked());
  });

  it('says so when macOS keeps the old login item state', async () => {
    const { user, spies } = await setup('general');
    spies.setLoginItem.mockResolvedValueOnce(true);
    const checkbox = screen.getByRole('checkbox', { name: 'Start at login' });
    await waitFor(() => expect(checkbox).toBeChecked());
    await user.click(checkbox);
    expect(await screen.findByText(/macOS did not change the login item/)).toBeInTheDocument();
    expect(checkbox).toBeChecked();
  });

  it('turns debug logging on', async () => {
    const { user, spies } = await setup('general');
    const checkbox = screen.getByRole('checkbox', { name: 'Debug logging' });
    expect(checkbox).not.toBeChecked();
    await user.click(checkbox);
    expect(spies.update).toHaveBeenCalledExactlyOnceWith({ debugLogging: true });
    await waitFor(() => expect(checkbox).toBeChecked());
  });

  it('opens the logs, shows why they cannot be opened, and the version', async () => {
    const { user, spies } = await setup('general');
    expect(await screen.findByText('Filey 1.0.0 (mock)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show logs' }));
    expect(spies.openLogs).toHaveBeenCalledOnce();

    spies.openLogs.mockResolvedValueOnce({ ok: false, reason: 'failed', message: 'The log file could not be opened.' });
    await user.click(screen.getByRole('button', { name: 'Show logs' }));
    expect(await screen.findByText('The log file could not be opened.')).toBeInTheDocument();
  });
});

describe('Settings: Provider', () => {
  const keyField = () => screen.getByLabelText('OpenRouter API key');
  const modelField = () => screen.getByRole('textbox', { name: /^Model/ });

  it('says a key is stored without showing it', async () => {
    await setup('provider', { apiKeyStatus: 'set' });
    await waitFor(() => expect(keyField()).toHaveAttribute('placeholder', 'Key saved in Keychain'));
    expect(keyField()).toHaveValue('');
    expect(keyField()).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Remove key' })).toBeInTheDocument();
    expect(screen.getByText('Stored in your macOS Keychain. Only ever sent to OpenRouter.')).toBeInTheDocument();
  });

  it('asks for a key when none is stored', async () => {
    await setup('provider', { apiKeyStatus: 'missing' });
    await waitFor(() => expect(keyField()).toHaveAttribute('placeholder', 'sk-or-…'));
    expect(screen.queryByRole('button', { name: 'Remove key' })).not.toBeInTheDocument();
  });

  it('explains an unreadable key (arc42 §6.6)', async () => {
    await setup('provider', { apiKeyStatus: 'unreadable' });
    const warning = await screen.findByText(/cannot read the saved key any more/);
    expect(keyField()).toHaveAttribute('placeholder', 'sk-or-…');
    expect(keyField().getAttribute('aria-describedby')).toContain(warning.id);
  });

  it('saves a pasted key and clears the field', async () => {
    const { user, spies } = await setup('provider', { apiKeyStatus: 'missing' });
    await user.type(keyField(), 'sk-or-v1-secret{Enter}');
    expect(spies.saveKey).toHaveBeenCalledExactlyOnceWith('sk-or-v1-secret');
    expect(await screen.findByText('Key saved in your Keychain.')).toBeInTheDocument();
    expect(keyField()).toHaveValue('');
    await waitFor(() => expect(keyField()).toHaveAttribute('placeholder', 'Key saved in Keychain'));
  });

  it('shows why a key could not be saved', async () => {
    const { user, spies } = await setup('provider', { apiKeyStatus: 'missing' });
    await user.click(screen.getByRole('button', { name: 'Save key' }));
    expect(spies.saveKey).not.toHaveBeenCalled();
    expect(keyField()).toHaveAccessibleDescription(/Paste your OpenRouter API key first/);

    spies.saveKey.mockResolvedValueOnce({ ok: false, reason: 'storage-unavailable', message: 'The Keychain is not available.' });
    await user.type(keyField(), 'sk-or-v1-secret');
    await user.click(screen.getByRole('button', { name: 'Save key' }));
    await waitFor(() => expect(keyField()).toHaveAccessibleDescription('The Keychain is not available.'));
    expect(keyField()).toHaveAttribute('aria-invalid', 'true');
  });

  it('removes the key after confirming', async () => {
    const { user, spies } = await setup('provider', { apiKeyStatus: 'set' });
    await user.click(await screen.findByRole('button', { name: 'Remove key' }));
    const confirm = screen.getByRole('group', { name: 'Remove the API key' });
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(spies.clearKey).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Remove key' }));
    await user.click(within(screen.getByRole('group', { name: 'Remove the API key' })).getByRole('button', { name: 'Remove key' }));
    expect(spies.clearKey).toHaveBeenCalledOnce();
    await waitFor(() => expect(keyField()).toHaveAttribute('placeholder', 'sk-or-…'));
    expect(screen.queryByRole('button', { name: 'Remove key' })).not.toBeInTheDocument();
  });

  it('shows the default model as placeholder and saves a typed model on blur', async () => {
    const { user, spies } = await setup('provider');
    expect(modelField()).toHaveValue('');
    expect(modelField()).toHaveAttribute('placeholder', 'google/gemini-2.5-flash');
    expect(modelField()).toHaveAccessibleDescription('Needs PDF or image input and structured output. Any OpenRouter model works.');

    await user.type(modelField(), 'openai/gpt-4o');
    // Tab passes the Test connection button; leaving it without a test saves the model.
    await user.tab();
    expect(screen.getByRole('button', { name: 'Test connection' })).toHaveFocus();
    expect(spies.update).not.toHaveBeenCalled();
    await user.tab();
    expect(spies.update).toHaveBeenCalledExactlyOnceWith({ model: 'openai/gpt-4o' });
    expect(await screen.findByText('Model saved.')).toBeInTheDocument();
    expect(modelField()).toHaveValue('openai/gpt-4o');

    // Emptying the field goes back to the default model.
    await user.clear(modelField());
    await user.keyboard('{Enter}');
    expect(spies.update).toHaveBeenLastCalledWith({ model: 'google/gemini-2.5-flash' });
  });

  it('shows a model error at the field', async () => {
    const { user, spies } = await setup('provider');
    spies.update.mockResolvedValueOnce({ ok: false, error: { message: 'The model must not be empty.', field: 'model' } });
    await user.type(modelField(), 'x{Enter}');
    await waitFor(() => expect(modelField()).toHaveAccessibleDescription('The model must not be empty.'));
  });

  it('tests the connection with the typed key and model, and saves a model that works', async () => {
    const { user, spies } = await setup('provider');
    let finish: (value: { ok: true; message: string }) => void = () => undefined;
    spies.test.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));

    await user.type(keyField(), 'sk-or-v1-new');
    await user.type(modelField(), 'anthropic/claude-sonnet-4');
    await user.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(spies.test).toHaveBeenCalledExactlyOnceWith({ key: 'sk-or-v1-new', model: 'anthropic/claude-sonnet-4' });
    // Leaving the field for the test button does not save the model before the test.
    expect(spies.update).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Testing…' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Sending the sample scan to OpenRouter…')).toBeInTheDocument();

    await act(async () => finish({ ok: true, message: 'Connected · model can read PDFs' }));
    expect(screen.getByText('Connected · model can read PDFs')).toHaveClass('settings-test-result--ok');
    expect(spies.update).toHaveBeenCalledExactlyOnceWith({ model: 'anthropic/claude-sonnet-4' });
    // The typed key is only tested, not saved.
    expect(spies.saveKey).not.toHaveBeenCalled();
  });

  it('tests the saved key and model when nothing is typed', async () => {
    const { user, spies } = await setup('provider');
    await user.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(spies.test).toHaveBeenCalledExactlyOnceWith({ model: 'google/gemini-2.5-flash' });
  });

  it.each<[ConnectionTestReason, string]>([
    ['invalid_key', 'OpenRouter rejected the API key. Check that you copied the whole key.'],
    ['unknown_model', 'OpenRouter does not know this model. Check the model name.'],
    ['cannot_read_scans', 'The model did not read the sample scan correctly.'],
    ['no_structured_output', 'The model did not return a structured result.'],
    ['offline', 'OpenRouter cannot be reached. Check your internet connection and try again.'],
    ['provider_error', 'OpenRouter reported an error (HTTP 500). Try again later.'],
  ])('reports a failed test (%s) in words', async (reason, message) => {
    const { user } = await setup('provider', { connection: { ok: false, reason, message } });
    await user.click(screen.getByRole('button', { name: 'Test connection' }));
    const result = await screen.findByText(message);
    expect(result).toHaveClass('settings-test-result--failed');
    expect(result.closest('[role="status"]')).not.toBeNull();
  });

  it('warns before saving a model whose test failed', async () => {
    const message = 'The model did not return a structured result.';
    const { user, spies } = await setup('provider', { connection: { ok: false, reason: 'no_structured_output', message } });
    await user.type(modelField(), 'some/text-model');
    await user.click(screen.getByRole('button', { name: 'Test connection' }));
    await screen.findByText(message);
    const warning = screen.getByRole('group', { name: 'Save a model that failed the test' });
    expect(within(warning).getByText(/The connection test failed for/)).toHaveTextContent('some/text-model');
    expect(spies.update).not.toHaveBeenCalled();

    // Leaving the field again does not save it either.
    await user.click(modelField());
    await user.tab();
    expect(spies.update).not.toHaveBeenCalled();

    await user.click(within(screen.getByRole('group', { name: 'Save a model that failed the test' })).getByRole('button', { name: 'Save anyway' }));
    expect(spies.update).toHaveBeenCalledExactlyOnceWith({ model: 'some/text-model' });
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Save a model that failed the test' })).not.toBeInTheDocument());
  });

  it('keeps the saved model when the warning is declined', async () => {
    const { user, spies } = await setup('provider', { connection: { ok: false, reason: 'unknown_model', message: 'Unknown model.' } });
    await user.type(modelField(), 'no/such-model');
    await user.click(screen.getByRole('button', { name: 'Test connection' }));
    await user.click(await screen.findByRole('button', { name: 'Keep the default model' }));
    expect(spies.update).not.toHaveBeenCalled();
    expect(modelField()).toHaveValue('');
    expect(modelField()).toHaveFocus();
  });

  it('shows the privacy note', async () => {
    await setup('provider');
    expect(screen.getByText(/^Privacy: document contents are sent to OpenRouter/)).toHaveClass('settings-privacy');
  });
});

describe('Settings: Filing', () => {
  const settings = { inboxPath: `${ICLOUD}/Documents/Inbox`, targetPath: `${ICLOUD}/Documents` };
  const template = () => screen.getByRole('textbox', { name: 'Naming template' });
  const preview = () => screen.getByText(/Invoice/);

  it('shows the folders as Finder names them', async () => {
    await setup('filing', { settings });
    expect(screen.getByText('iCloud Drive/Documents/Inbox')).toHaveAttribute('title', `${ICLOUD}/Documents/Inbox`);
    expect(screen.getByText('iCloud Drive/Documents')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose… Inbox folder' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose… Target folder' })).toBeInTheDocument();
  });

  it('saves a chosen folder', async () => {
    const { user, spies } = await setup('filing', { settings, chosenFolder: `${ICLOUD}/Scans` });
    await user.click(screen.getByRole('button', { name: 'Choose… Inbox folder' }));
    expect(spies.chooseFolder).toHaveBeenCalledExactlyOnceWith('inbox');
    expect(spies.update).toHaveBeenCalledExactlyOnceWith({ inboxPath: `${ICLOUD}/Scans` });
    expect(await screen.findByText('iCloud Drive/Scans')).toBeInTheDocument();
    expect(screen.getByText('Saved.')).toBeInTheDocument();
  });

  it('does nothing when the picker is cancelled', async () => {
    const { user, spies } = await setup('filing', { settings });
    await user.click(screen.getByRole('button', { name: 'Choose… Target folder' }));
    expect(spies.chooseFolder).toHaveBeenCalledExactlyOnceWith('target');
    expect(spies.update).not.toHaveBeenCalled();
  });

  it('shows a rejected folder under the field', async () => {
    const { user, spies } = await setup('filing', { settings, chosenFolder: `${ICLOUD}/Documents/Inbox` });
    const message = 'The target folder must not be the inbox folder, otherwise filed documents would be imported again.';
    spies.update.mockResolvedValueOnce({ ok: false, error: { message, field: 'targetPath' } });
    await user.click(screen.getByRole('button', { name: 'Choose… Target folder' }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose… Target folder' })).toHaveAccessibleDescription(`iCloud Drive/Documents ${message}`);
    expect(screen.getByText('iCloud Drive/Documents')).toHaveClass('settings-path--invalid');
  });

  it('previews the naming template for a sample document as you type', async () => {
    const { user } = await setup('filing', { settings });
    expect(template()).toHaveValue('{category}/{date}_{sender}_{title}.pdf');
    expect(preview()).toHaveTextContent('Insurance/Car/2026-03-12_Northwind_Invoice.pdf');
    expect(template()).toHaveAccessibleDescription('Example: Insurance/Car/2026-03-12_Northwind_Invoice.pdf');

    await user.clear(template());
    await user.type(template(), '{{date} {{title}.pdf');
    expect(preview()).toHaveTextContent('2026-03-12 Invoice.pdf');
  });

  it('saves the template on blur and shows a validation error', async () => {
    const { user, spies } = await setup('filing', { settings });
    const message = 'Unknown placeholder {year} in the naming template. Allowed: {category}, {date}, {sender}, {title}.';
    spies.update.mockResolvedValueOnce({ ok: false, error: { message, field: 'namingTemplate' } });
    await user.clear(template());
    await user.type(template(), '{{year}.pdf');
    await user.tab();
    expect(spies.update).toHaveBeenCalledExactlyOnceWith({ namingTemplate: '{year}.pdf' });
    await waitFor(() => expect(template()).toHaveAttribute('aria-invalid', 'true'));
    expect(template()).toHaveAccessibleDescription(new RegExp(`${message.replace(/[{}.]/g, '\\$&')}`));

    await user.clear(template());
    await user.type(template(), '{{date}_{{title}.pdf{Enter}');
    expect(spies.update).toHaveBeenLastCalledWith({ namingTemplate: '{date}_{title}.pdf' });
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    expect(template()).not.toHaveAttribute('aria-invalid');
  });

  it('lists the rules with Unsorted required and not removable', async () => {
    await setup('filing', { settings });
    const list = screen.getByRole('list', { name: 'Folder rules' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(MOCK_RULES.length);
    expect(within(items[0]!).getByRole('textbox', { name: 'Folder of rule 1' })).toHaveValue('Insurance/Car');
    expect(within(items[0]!).getByRole('button', { name: 'Remove rule Insurance/Car' })).toBeInTheDocument();
    const unsorted = items[2]!;
    expect(within(unsorted).getByText('Unsorted')).toBeInTheDocument();
    expect(within(unsorted).getByText('Required')).toBeInTheDocument();
    expect(within(unsorted).queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
    expect(within(unsorted).getByRole('textbox', { name: 'Description of Unsorted' })).toHaveValue('Fallback when nothing matches');
    expect(screen.getByText('Changes apply to the next import only.')).toBeInTheDocument();
  });

  it('adds, edits, removes and saves rules', async () => {
    const { user, spies } = await setup('filing', { settings });
    await user.click(screen.getByRole('button', { name: 'Add rule' }));
    const folder = screen.getByRole('textbox', { name: 'Folder of rule 3' });
    expect(folder).toHaveFocus();
    await user.type(folder, ' Taxes ');
    await user.type(screen.getByRole('textbox', { name: 'Description of rule 3' }), 'Letters from the tax office');
    await user.click(screen.getByRole('button', { name: 'Remove rule Insurance/Car' }));
    expect(screen.getByRole('button', { name: 'Add rule' })).toHaveFocus();
    await user.clear(screen.getByRole('textbox', { name: 'Description of Unsorted' }));
    await user.type(screen.getByRole('textbox', { name: 'Description of Unsorted' }), 'Everything else');
    expect(screen.getByText('Unsaved changes.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save rules' }));
    expect(spies.saveRules).toHaveBeenCalledExactlyOnceWith([
      { folder: 'Health/Health insurance', description: 'Letters from my health insurer' },
      { folder: 'Taxes', description: 'Letters from the tax office' },
      { folder: 'Unsorted', description: 'Everything else' },
    ]);
    expect(await screen.findByText('Rules saved.')).toBeInTheDocument();
    // The preview uses the first saved rule as category.
    expect(preview()).toHaveTextContent('Health/Health insurance/2026-03-12_Northwind_Invoice.pdf');
  });

  it('disables Save rules and says so while there is nothing to save', async () => {
    const { user, spies } = await setup('filing', { settings });
    const save = screen.getByRole('button', { name: 'Save rules' });
    expect(save).toBeDisabled();
    expect(screen.getByText('No changes to save. The rules are already saved.')).toBeInTheDocument();
    await user.click(save);
    expect(spies.saveRules).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Description of rule 2' }), '!');
    expect(save).toBeEnabled();
    await user.type(screen.getByRole('textbox', { name: 'Description of rule 2' }), '{Backspace}');
    expect(save).toBeDisabled();
  });

  describe('rule editor dialog', () => {
    const FIELD = 'What belongs in this folder, in plain words';
    const openEditor = async () => {
      const ctx = await setup('filing', { settings });
      const button = screen.getByRole('button', { name: 'Edit rule Insurance/Car' });
      await ctx.user.click(button);
      return { ...ctx, button };
    };

    it('opens a labelled dialog with the rule text and the folder in the title', async () => {
      await openEditor();
      const dialog = screen.getByRole('dialog', { name: /Edit rule: Insurance\/Car/ });
      const text = within(dialog).getByRole('textbox', { name: FIELD });
      expect(text.tagName).toBe('TEXTAREA');
      expect(text).toHaveValue(MOCK_RULES[0]!.description);
      expect(text).toHaveFocus();
    });

    it('writes the text back on Save, returns focus and leaves saving to Save rules', async () => {
      const { user, spies, button } = await openEditor();
      const text = screen.getByRole('textbox', { name: FIELD });
      await user.clear(text);
      await user.type(text, 'Line one{Enter}Line two');
      await user.click(screen.getByRole('button', { name: 'Save' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(button).toHaveFocus();
      expect(screen.getByRole('textbox', { name: 'Description of rule 1' })).toHaveValue('Line oneLine two');
      expect(screen.getByText('Unsaved changes.')).toBeInTheDocument();
      expect(spies.saveRules).not.toHaveBeenCalled();
    });

    it('discards the edit on Cancel and on Escape', async () => {
      const { user, button } = await openEditor();
      const original = MOCK_RULES[0]!.description;
      await user.type(screen.getByRole('textbox', { name: FIELD }), ' extra');
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(button).toHaveFocus();
      expect(screen.getByRole('textbox', { name: 'Description of rule 1' })).toHaveValue(original);

      await user.click(button);
      await user.type(screen.getByRole('textbox', { name: FIELD }), ' extra');
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(button).toHaveFocus();
      expect(screen.getByRole('textbox', { name: 'Description of rule 1' })).toHaveValue(original);
      expect(screen.queryByText('Unsaved changes.')).not.toBeInTheDocument();
    });

    it('also edits the Unsorted rule', async () => {
      const { user } = await setup('filing', { settings });
      await user.click(screen.getByRole('button', { name: 'Edit rule Unsorted' }));
      expect(screen.getByRole('dialog', { name: /Edit rule: Unsorted/ })).toBeInTheDocument();
    });
  });

  it('points a rule error at the rule', async () => {
    const { user, spies } = await setup('filing', { settings });
    const message = 'The folder "Health/Health insurance" needs a description.';
    spies.saveRules.mockResolvedValueOnce({ ok: false, error: { message, field: 'rules', ruleIndex: 1 } });
    await user.clear(screen.getByRole('textbox', { name: 'Description of rule 2' }));
    await user.click(screen.getByRole('button', { name: 'Save rules' }));

    const folder = screen.getByRole('textbox', { name: 'Folder of rule 2' });
    await waitFor(() => expect(folder).toHaveAttribute('aria-invalid', 'true'));
    expect(folder).toHaveFocus();
    expect(folder).toHaveAccessibleDescription(message);
    expect(screen.getByRole('textbox', { name: 'Description of rule 2' })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('textbox', { name: 'Folder of rule 1' })).not.toHaveAttribute('aria-invalid');
  });

  it('keeps unsaved rules when switching tabs', async () => {
    const { user } = await setup('filing', { settings });
    await user.click(screen.getByRole('button', { name: 'Add rule' }));
    await user.type(screen.getByRole('textbox', { name: 'Folder of rule 3' }), 'Arbeit');
    await user.click(screen.getByRole('tab', { name: 'General' }));
    await user.click(screen.getByRole('tab', { name: 'Filing' }));
    expect(screen.getByRole('textbox', { name: 'Folder of rule 3' })).toHaveValue('Arbeit');
  });
});

describe('Settings: live updates', () => {
  it('re-reads the key status when imports pause', async () => {
    const { emit, api } = await setup('provider', { apiKeyStatus: 'set' });
    const status = vi.spyOn(api.apiKey, 'status').mockResolvedValue('unreadable');
    act(() => emit('state:changed', { mode: 'paused', reason: 'unreadable', queuedCount: 0, analyzingId: null, attentionCount: 0 }));
    expect(status).toHaveBeenCalled();
    expect(await screen.findByText(/cannot read the saved key any more/)).toBeInTheDocument();
  });

  it('shows settings saved in another window', async () => {
    const { emit, api } = await setup('filing');
    const next = { ...(await api.settings.get()), namingTemplate: '{title}.pdf' };
    act(() => emit('settings:changed', next));
    expect(screen.getByRole('textbox', { name: 'Naming template' })).toHaveValue('{title}.pdf');
  });
});

describe('Settings: Provider with Ollama', () => {
  const radio = (name: RegExp) => screen.getByRole('radio', { name });

  it('shows the two providers and starts with the saved one', async () => {
    await setup('provider');
    expect(radio(/OpenRouter/)).toBeChecked();
    expect(radio(/Ollama/)).not.toBeChecked();
    expect(screen.getByLabelText('OpenRouter API key')).toBeInTheDocument();
    expect(screen.queryByLabelText('Ollama address')).not.toBeInTheDocument();
  });

  it('switches to Ollama: saves the provider, hides the key and shows Ollama\'s settings and privacy note', async () => {
    const { user, spies } = await setup('provider');
    await user.click(radio(/Ollama/));
    expect(spies.update).toHaveBeenCalledExactlyOnceWith({ provider: 'ollama' });
    expect(await screen.findByLabelText('Ollama address')).toHaveValue('http://localhost:11434');
    expect(screen.getByLabelText('Model')).toHaveValue('qwen2.5vl:7b');
    expect(screen.queryByLabelText('OpenRouter API key')).not.toBeInTheDocument();
    expect(await screen.findByText(/Ollama 0.12.3 is running/)).toBeInTheDocument();
    expect(screen.getByText(/document contents stay on your Mac/)).toBeInTheDocument();
    expect(radio(/Ollama/)).toBeChecked();
  });

  it('switches back to OpenRouter and keeps the saved key and model', async () => {
    const { user } = await setup('provider', { settings: { provider: 'ollama', model: 'openai/gpt-4o' } });
    await user.click(radio(/OpenRouter/));
    expect(await screen.findByLabelText('OpenRouter API key')).toHaveAttribute('placeholder', 'Key saved in Keychain');
    expect(screen.getByLabelText(/^Model/)).toHaveValue('openai/gpt-4o');
  });

  it('shows why the provider could not be changed', async () => {
    const { user } = await setup('provider', { rejectUpdate: () => ({ message: 'Unsupported provider.' }) });
    await user.click(radio(/Ollama/));
    expect(await screen.findByText('Unsupported provider.')).toBeInTheDocument();
    expect(radio(/OpenRouter/)).toBeChecked();
  });

  it('saves a changed address when the field is left and shows a refused one', async () => {
    const { user, spies } = await setup('provider', {
      settings: { provider: 'ollama' },
      rejectUpdate: (patch) => (patch.ollamaUrl === 'http://192.168.1.5:11434' ? { message: 'The Ollama address must point to this Mac, e.g. http://localhost:11434.', field: 'ollamaUrl' } : undefined),
    });
    const field = await screen.findByLabelText('Ollama address');
    await user.clear(field);
    await user.type(field, 'http://127.0.0.1:11500{Enter}');
    expect(spies.update).toHaveBeenCalledWith({ ollamaUrl: 'http://127.0.0.1:11500' });
    await waitFor(() => expect(field).toHaveValue('http://127.0.0.1:11500'));

    await user.clear(field);
    await user.type(field, 'http://192.168.1.5:11434{Enter}');
    expect(await screen.findByText(/must point to this Mac/)).toBeInTheDocument();
    expect(field).toHaveAttribute('aria-invalid', 'true');
  });

  it('falls back to the standard address for an empty field', async () => {
    const { user, spies } = await setup('provider', { settings: { provider: 'ollama', ollamaUrl: 'http://localhost:11500' } });
    const field = await screen.findByLabelText('Ollama address');
    await user.clear(field);
    await user.keyboard('{Enter}');
    expect(spies.update).toHaveBeenCalledExactlyOnceWith({ ollamaUrl: 'http://localhost:11434' });
  });

  it('tests the connection with Ollama and the saved model, and shows the result', async () => {
    const { user, spies } = await setup('provider', { settings: { provider: 'ollama' }, connection: { ok: true, message: 'Connected · model can read scans' } });
    await screen.findByText(/is running/);
    await user.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(spies.test).toHaveBeenCalledExactlyOnceWith({ provider: 'ollama', model: 'qwen2.5vl:7b' });
    expect(await screen.findByText('Connected · model can read scans')).toBeInTheDocument();
  });

  it('shows why the Ollama test failed, and a test that could not run', async () => {
    const { user, spies } = await setup('provider', {
      settings: { provider: 'ollama' },
      connection: { ok: false, reason: 'model_not_installed', message: 'The model qwen2.5vl:7b is not installed. Download it first.' },
    });
    await screen.findByText(/is running/);
    await user.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText('The model qwen2.5vl:7b is not installed. Download it first.')).toBeInTheDocument();
    spies.test.mockRejectedValueOnce(new Error('ipc'));
    await user.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText('Filey could not run the connection test.')).toBeInTheDocument();
  });

  it('keeps the OpenRouter test unchanged: it does not name a provider', async () => {
    const { user, spies } = await setup('provider');
    await user.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(spies.test).toHaveBeenCalledExactlyOnceWith({ model: 'google/gemini-2.5-flash' });
  });
});


describe('Settings: Filing — folder tree (arc42 §5.4)', () => {
  const tree = () => screen.getByRole('list', { name: 'Folders in the target folder' });

  it('scans and shows every folder with its rule state', async () => {
    const { user } = await setup('filing');
    expect(screen.getByText(/Scan the target folder to see its folders/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Scan' }));

    const rows = within(await screen.findByRole('list', { name: 'Folders in the target folder' }));
    expect(rows.getByText('Letters from my health insurer')).toBeInTheDocument();
    expect(rows.getByRole('button', { name: 'Add rule for Taxes' })).toBeInTheDocument();
    expect(rows.getAllByText('No rule')).toHaveLength(2); // Health and Taxes
    expect(rows.getByText(/Everything about my car insurance.*created on the next filing/)).toBeInTheDocument();
    expect(screen.getByText(/3 folders, 5 files · scanned at/)).toHaveTextContent('2 folders without a rule');
    expect(screen.getByRole('button', { name: 'Rescan' })).toBeInTheDocument();
  });

  it('shows the last scan when the tab opens', async () => {
    await setup('filing', { lastScan: { folders: [{ path: 'Taxes', fileCount: 1, sampleFileNames: [] }], fileCount: 1, truncated: true, scannedAt: '2026-10-15T10:00:00.000Z' } });
    expect(await screen.findByRole('button', { name: 'Add rule for Taxes' })).toBeInTheDocument();
    expect(screen.getByText(/The scan stopped at its limit/)).toBeInTheDocument();
  });

  it('says why a scan failed', async () => {
    const { user } = await setup('filing', { scan: { ok: false, reason: 'missing', message: 'The target folder does not exist. Choose another one above.' } });
    await user.click(screen.getByRole('button', { name: 'Scan' }));
    expect(await screen.findByText('The target folder does not exist. Choose another one above.')).toBeInTheDocument();
  });

  it('adds a rule from the tree right away and shows it in the rule list', async () => {
    const { user, spies } = await setup('filing');
    await user.click(screen.getByRole('button', { name: 'Scan' }));
    await user.click(await screen.findByRole('button', { name: 'Add rule for Taxes' }));
    const dialog = screen.getByRole('dialog', { name: /Edit rule: Taxes/ });
    await user.type(within(dialog).getByRole('textbox'), 'Letters from the tax office');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(spies.saveRules).toHaveBeenCalledExactlyOnceWith([
      MOCK_RULES[0],
      MOCK_RULES[1],
      { folder: 'Taxes', description: 'Letters from the tax office' },
      MOCK_RULES[2],
    ]);
    expect(await within(tree()).findByText('Letters from the tax office')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Folder of rule 3' })).toHaveValue('Taxes');
    expect(screen.getByText('Rule saved.')).toBeInTheDocument();
  });

  it('maps folders after review, with suggested descriptions', async () => {
    const { user, spies, api } = await setup('filing');
    const suggest = vi.spyOn(api.folders, 'suggestDescriptions');
    await user.click(screen.getByRole('button', { name: 'Scan' }));
    await user.click(await screen.findByRole('button', { name: 'Map folders' }));

    const panel = within(screen.getByRole('region', { name: 'Map folders' }));
    expect(panel.getByRole('checkbox', { name: 'Health' })).not.toBeChecked();
    expect(panel.getByRole('checkbox', { name: 'Taxes' })).toBeChecked();
    expect(panel.getByRole('textbox', { name: 'Description of Taxes' })).toHaveValue('Documents about Taxes');
    expect(panel.getByText(/sends the folder names and up to 5 file names per folder to OpenRouter/)).toBeInTheDocument();

    await user.click(panel.getByRole('button', { name: 'Suggest descriptions' }));
    expect(suggest).toHaveBeenCalledExactlyOnceWith(['Taxes']);
    await waitFor(() => expect(panel.getByRole('textbox', { name: 'Description of Taxes' })).toHaveValue('About Taxes'));

    await user.click(panel.getByRole('button', { name: 'Add 1 rule' }));
    expect(spies.saveRules).toHaveBeenCalledExactlyOnceWith([MOCK_RULES[0], MOCK_RULES[1], { folder: 'Taxes', description: 'About Taxes' }, MOCK_RULES[2]]);
    expect(await screen.findByText('1 rule added.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Map folders' })).not.toBeInTheDocument();
  });

  it('names Ollama when it is the provider', async () => {
    const { user } = await setup('filing', { settings: { provider: 'ollama' } });
    await user.click(screen.getByRole('button', { name: 'Scan' }));
    await user.click(await screen.findByRole('button', { name: 'Map folders' }));
    expect(screen.getByText(/asks Ollama on this Mac/)).toBeInTheDocument();
  });
});

describe('Settings: Names (arc42 §5.4)', () => {
  it('checks names, suggests names for the selected files and renames after Accept', async () => {
    const { user, api } = await setup('names');
    const suggest = vi.spyOn(api.names, 'suggest');
    const apply = vi.spyOn(api.names, 'apply');
    await user.click(screen.getByRole('button', { name: 'Check names' }));

    const files = within(await screen.findByRole('list', { name: 'Files to rename' }));
    expect(screen.getByText('2 of 5 PDFs do not follow the naming template.')).toBeInTheDocument();
    expect(files.getByRole('checkbox', { name: 'Tax 2025.pdf' })).toBeChecked();
    expect(files.getByText('Target folder · in iCloud, downloaded first')).toBeInTheDocument();
    expect(screen.getByText(/sends the selected documents to OpenRouter, like an import/)).toBeInTheDocument();
    await user.click(files.getByRole('checkbox', { name: 'Scan 12.pdf' }));

    await user.click(screen.getByRole('button', { name: 'Suggest names (1)' }));
    expect(suggest).toHaveBeenCalledExactlyOnceWith(['Taxes/Tax 2025.pdf']);
    const queue = within(await screen.findByRole('list', { name: 'Proposed names' }));
    expect(queue.getByText('2026-10-15_Northwind_Invoice.pdf')).toBeInTheDocument();
    expect(apply).not.toHaveBeenCalled();

    await user.click(queue.getByRole('button', { name: 'Accept 2026-10-15_Northwind_Invoice.pdf for Tax 2025.pdf' }));
    expect(apply).toHaveBeenCalledExactlyOnceWith(['Taxes/Tax 2025.pdf']);
    expect(await queue.findByText('Renamed')).toBeInTheDocument();
    expect(screen.getByText('1 file renamed.')).toBeInTheDocument();
  });

  it('accepts all, skips, and shows per-file errors', async () => {
    const { user } = await setup('names', {
      applyNames: (paths) => paths.map((path) => ({ path, ok: false, message: 'The file is no longer there. Check names again.' })),
    });
    await user.click(screen.getByRole('button', { name: 'Check names' }));
    await user.click(await screen.findByRole('button', { name: 'Suggest names (2)' }));
    const queue = within(await screen.findByRole('list', { name: 'Proposed names' }));
    await user.click(queue.getByRole('button', { name: 'Skip Scan 12.pdf' }));
    expect(queue.queryByText('Scan 12.pdf')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Accept all (1)' }));
    expect(await queue.findByText('The file is no longer there. Check names again.')).toBeInTheDocument();
    expect(screen.getByText('1 file could not be renamed.')).toBeInTheDocument();
  });

  it('says why suggesting failed', async () => {
    const { user } = await setup('names', {
      nameCheck: { ok: true, checked: 4, truncated: false, issues: MOCK_NAME_CHECK.ok ? MOCK_NAME_CHECK.issues.slice(0, 1) : [] },
      suggestNames: () => ({ ok: false, reason: 'missing-key', message: 'Add your OpenRouter API key under Provider first.' }),
    });
    await user.click(screen.getByRole('button', { name: 'Check names' }));
    await user.click(await screen.findByRole('button', { name: 'Suggest names (1)' }));
    expect(await screen.findByText('Add your OpenRouter API key under Provider first.')).toBeInTheDocument();
  });

  it('says when every name already follows the template', async () => {
    const { user } = await setup('names', { nameCheck: { ok: true, checked: 4, truncated: false, issues: [] } });
    await user.click(screen.getByRole('button', { name: 'Check names' }));
    expect(await screen.findByText('All 4 PDFs follow the naming template.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument();
  });
});
