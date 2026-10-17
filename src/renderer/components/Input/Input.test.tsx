import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Input } from './Input';

describe('Input', () => {
  it('labels the field and links the hint with aria-describedby', () => {
    render(<Input label="Folder name" hint="Shown in the sidebar." defaultValue="Invoices 2026" />);
    const input = screen.getByRole('textbox', { name: 'Folder name' });
    expect(input).toHaveAccessibleDescription('Shown in the sidebar.');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('replaces the hint with the error and marks the field invalid', () => {
    render(<Input label="OpenRouter API key" hint="Stored in your macOS Keychain." error="The key must start with sk-or-." />);
    const input = screen.getByRole('textbox', { name: 'OpenRouter API key' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('The key must start with sk-or-.');
    expect(screen.queryByText('Stored in your macOS Keychain.')).not.toBeInTheDocument();
  });

  it('keeps an existing aria-describedby', () => {
    render(
      <>
        <p id="extra">Extra</p>
        <Input label="Model" hint="Optional." aria-describedby="extra" />
      </>,
    );
    expect(screen.getByRole('textbox')).toHaveAccessibleDescription('Extra Optional.');
  });

  it('has no description without hint or error', () => {
    render(<Input label="Model" />);
    expect(screen.getByRole('textbox')).not.toHaveAttribute('aria-describedby');
  });

  it('supports the mono and password variants', () => {
    const { container } = render(<Input label="OpenRouter API key" variant="mono" type="password" defaultValue="sk-or-v1-0" />);
    const input = container.querySelector('input')!;
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveClass('filey-input--mono');
    expect(input).toHaveAttribute('spellcheck', 'false');
    expect(screen.getByLabelText('OpenRouter API key')).toBe(input);
  });

  it('marks optional fields and can hide the label visually', () => {
    const { rerender } = render(<Input label="Model" optional />);
    expect(screen.getByText('(optional)')).toBeInTheDocument();
    rerender(<Input label="Search imports" hideLabel type="search" />);
    expect(screen.getByRole('searchbox', { name: 'Search imports' })).toBeInTheDocument();
    expect(screen.getByText('Search imports')).toHaveClass('visually-hidden');
  });

  it('reports typing through onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Input label="Naming template" onChange={onChange} />);
    await user.type(screen.getByRole('textbox'), 'ab');
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('forwards a ref to the input element', () => {
    const ref = createRef<HTMLInputElement>();
    render(<Input label="Search imports" ref={ref} />);
    expect(ref.current).toBe(screen.getByLabelText('Search imports'));
  });
});
