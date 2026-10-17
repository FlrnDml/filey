import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ConnectionTestReason, SettingsTab } from '../../../core/ipc';
import { FIXTURE_NOW } from '../../test/fixtures';
import { createMockFiley, MOCK_RULES, type MockFileyOptions } from '../../test/mockFiley';
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
