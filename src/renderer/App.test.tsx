import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { installMockFiley } from './test/mockFiley';

beforeEach(() => {
  installMockFiley();
  window.history.replaceState(null, '', '/');
});

describe('App', () => {
  it('shows the popover for #popover', async () => {
    render(<App hash="#popover" />);
    expect(await screen.findByRole('combobox', { name: 'Search filed documents' })).toBeInTheDocument();
    expect(document.documentElement.dataset.surface).toBe('popover');
    expect(document.title).toBe('Filey');
  });

  it('shows Settings on the requested tab and follows the fragment', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '#settings/provider');
    render(<App hash="#settings/provider" />);
    expect(screen.getByRole('tab', { name: 'Provider' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByLabelText('OpenRouter API key')).toBeInTheDocument();
    expect(document.title).toBe('Settings');

    // Main opens another tab by changing the fragment.
    act(() => {
      window.history.replaceState(null, '', '#settings/filing');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(screen.getByRole('tab', { name: 'Filing' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('textbox', { name: 'Naming template' })).toBeInTheDocument();

    // Choosing a tab writes it back, so the window URL stays a valid app page.
    await user.click(screen.getByRole('tab', { name: 'General' }));
    expect(window.location.hash).toBe('#settings/general');
  });

  it('shows the first-launch window for #onboarding', async () => {
    render(<App hash="#onboarding" />);
    expect(screen.getByRole('heading', { name: 'Scan it. Filed.' })).toBeInTheDocument();
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
    expect(document.title).toBe('Welcome to Filey');
    await act(async () => undefined); // the key status loads
  });

  it('shows nothing useful for an unknown fragment', () => {
    render(<App hash="#other" />);
    expect(screen.getByRole('alert')).toHaveTextContent('This window has no content.');
  });
});
