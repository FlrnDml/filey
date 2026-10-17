import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createMockFiley, type MockFileyOptions } from '../../test/mockFiley';
import { ONBOARDING_TEXT, OnboardingScreen, type OnboardingStep } from './OnboardingScreen';

const KEY = 'sk-or-v1-test-key';

function setup(options: MockFileyOptions = { apiKeyStatus: 'missing' }, initialStep?: OnboardingStep) {
  const { api } = createMockFiley(options);
  const spies = {
    save: vi.spyOn(api.apiKey, 'save'),
    setLoginItem: vi.spyOn(api.app, 'setLoginItem'),
    complete: vi.spyOn(api.app, 'completeOnboarding'),
  };
  const user = userEvent.setup();
  render(<OnboardingScreen api={api} initialStep={initialStep} />);
  return { api, spies, user };
}

const continueButton = () => screen.getByRole('button', { name: 'Continue' });
const keyField = () => screen.getByLabelText('OpenRouter API key');

describe('Onboarding step 1: API key', () => {
  it('shows the mark, the counter and the tagline, with the key field focused', async () => {
    setup();
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Scan it. Filed.' })).toBeInTheDocument();
    expect(screen.getByText(ONBOARDING_TEXT.keyIntro)).toBeInTheDocument();
    expect(keyField()).toHaveFocus();
    expect(keyField()).toHaveAttribute('type', 'password');
    expect(keyField()).toHaveAttribute('placeholder', 'sk-or-…');
  });

  it('keeps Continue disabled until a key is present', async () => {
    const { user } = setup();
    expect(continueButton()).toBeDisabled();
    await user.type(keyField(), '   ');
    expect(continueButton()).toBeDisabled();
    await user.clear(keyField());
    await user.type(keyField(), KEY);
    expect(continueButton()).toBeEnabled();
  });

  it('saves the trimmed key and moves on (Return works too)', async () => {
    const { user, spies } = setup();
    await user.type(keyField(), ` ${KEY} {Enter}`);
    expect(spies.save).toHaveBeenCalledExactlyOnceWith(KEY);
    expect(await screen.findByText('2 of 3')).toBeInTheDocument();
  });

  it('shows why the key could not be saved and stays on the step', async () => {
    const { user, spies } = setup();
    spies.save.mockResolvedValueOnce({ ok: false, reason: 'storage-unavailable', message: 'The API key could not be stored securely' });
    await user.type(keyField(), KEY);
    await user.click(continueButton());
    expect(await screen.findByText('The API key could not be stored securely')).toBeInTheDocument();
    expect(keyField()).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('1 of 3')).toBeInTheDocument();

    spies.save.mockRejectedValueOnce(new Error('ipc'));
    await user.click(continueButton());
    expect(await screen.findByText('Filey could not save the key.')).toBeInTheDocument();
  });

  it('lets a key saved earlier count as present, without saving it again', async () => {
    const { user, spies } = setup({ apiKeyStatus: 'set' });
    await waitFor(() => expect(keyField()).toHaveAttribute('placeholder', ONBOARDING_TEXT.keySaved));
    await user.click(continueButton());
    expect(spies.save).not.toHaveBeenCalled();
    expect(await screen.findByText('2 of 3')).toBeInTheDocument();
  });

  it('does not skip the setup on Esc', async () => {
    const { user, spies } = setup();
    await user.keyboard('{Escape}');
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
    expect(spies.complete).not.toHaveBeenCalled();
  });
});

describe('Onboarding step 2: start at login', () => {
  it.each([
    ['Start at login', true],
    ['Not now', false],
  ] as const)('"%s" applies the choice and moves on', async (label, enabled) => {
    const { user, spies } = setup(undefined, 2);
    expect(screen.getByRole('heading', { name: 'Start at login?' })).toBeInTheDocument();
    expect(screen.getByText(ONBOARDING_TEXT.loginHint)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: label }));
    expect(spies.setLoginItem).toHaveBeenCalledExactlyOnceWith(enabled);
    expect(await screen.findByText('3 of 3')).toBeInTheDocument();
  });

  it('focuses the primary choice, so Return starts at login', async () => {
    const { user, spies } = setup(undefined, 2);
    expect(screen.getByRole('button', { name: 'Start at login' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(spies.setLoginItem).toHaveBeenCalledWith(true);
  });

  it('says so when the login item cannot be changed and stays', async () => {
    const { user, spies } = setup(undefined, 2);
    spies.setLoginItem.mockRejectedValueOnce(new Error('ipc'));
    await user.click(screen.getByRole('button', { name: 'Start at login' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Filey could not change the login item.');
    expect(screen.getByText('2 of 3')).toBeInTheDocument();
  });
});

describe('Onboarding step 3: menu bar', () => {
  it('explains the menu bar and completes onboarding with "Got it"', async () => {
    const { user, spies } = setup(undefined, 3);
    expect(screen.getByRole('heading', { name: 'Filey lives in the menu bar' })).toBeInTheDocument();
    expect(screen.getByText(ONBOARDING_TEXT.menuBarIntro)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'The Filey icon in the menu bar' })).toBeInTheDocument();
    const gotIt = screen.getByRole('button', { name: 'Got it' });
    expect(gotIt).toHaveFocus();
    await user.click(gotIt);
    expect(spies.complete).toHaveBeenCalledOnce();
  });

  it('explains where the scans go, with the folders created in iCloud Drive', async () => {
    setup(undefined, 3);
    expect(await screen.findByText('iCloud Drive/Documents/Filey/Inbox')).toBeInTheDocument();
    expect(screen.getByText('iCloud Drive/Documents/Filey')).toBeInTheDocument();
    expect(screen.getByText(ONBOARDING_TEXT.foldersHint)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('points to Settings → Filing when the iCloud Drive folder could not be created, and still lets the user finish', async () => {
    const folderSetup = { status: 'failed', inboxPath: '/Users/me/Library/Mobile Documents/com~apple~CloudDocs/Documents/Filey/Inbox', targetPath: '/x' } as const;
    const { user, api, spies } = setup({ apiKeyStatus: 'missing', folderSetup }, 3);
    const openSettings = vi.spyOn(api.app, 'openSettings');
    expect(await screen.findByRole('alert')).toHaveTextContent(ONBOARDING_TEXT.foldersFailed);
    await user.click(screen.getByRole('button', { name: 'Open Settings' }));
    expect(openSettings).toHaveBeenCalledExactlyOnceWith('filing');
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    expect(spies.complete).toHaveBeenCalledOnce();
  });

  it('still works when the folder setup cannot be read', async () => {
    const { api } = createMockFiley({ apiKeyStatus: 'missing' });
    vi.spyOn(api.app, 'getFolderSetup').mockRejectedValue(new Error('ipc'));
    render(<OnboardingScreen api={api} initialStep={3} />);
    expect(screen.getByRole('button', { name: 'Got it' })).toBeEnabled();
    await waitFor(() => expect(api.app.getFolderSetup).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows an error when completing fails', async () => {
    const { user, spies } = setup(undefined, 3);
    spies.complete.mockRejectedValueOnce(new Error('ipc'));
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Filey could not finish the setup.');
  });
});

describe('Onboarding flow', () => {
  it('runs through all three steps with one primary button each', async () => {
    const { user, spies } = setup();
    await user.type(keyField(), KEY);
    await user.click(continueButton());
    await screen.findByText('2 of 3');
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    await screen.findByText('3 of 3');
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    expect(spies.save).toHaveBeenCalledWith(KEY);
    expect(spies.setLoginItem).toHaveBeenCalledWith(false);
    expect(spies.complete).toHaveBeenCalledOnce();
    expect(document.querySelectorAll('.filey-button--primary')).toHaveLength(1);
  });
});
