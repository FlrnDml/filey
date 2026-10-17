import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';

describe('Button', () => {
  it('is a secondary type="button" by default', () => {
    render(<Button>Cancel</Button>);
    const button = screen.getByRole('button', { name: 'Cancel' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass('filey-button', 'filey-button--secondary');
  });

  it.each(['primary', 'secondary', 'danger'] as const)('renders the %s variant', (variant) => {
    render(<Button variant={variant}>Go</Button>);
    expect(screen.getByRole('button')).toHaveClass(`filey-button--${variant}`);
  });

  it('calls onClick from mouse and keyboard, but not when disabled', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Move</Button>);
    await user.click(screen.getByRole('button'));
    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(2);

    rerender(
      <Button onClick={onClick} disabled>
        Move
      </Button>,
    );
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('is reachable with Tab', async () => {
    const user = userEvent.setup();
    render(<Button>Choose…</Button>);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Choose…' })).toHaveFocus();
  });

  it('has a small size for inline row actions', () => {
    const { rerender } = render(<Button>Retry</Button>);
    expect(screen.getByRole('button')).not.toHaveClass('filey-button--small');
    rerender(<Button size="small">Retry</Button>);
    expect(screen.getByRole('button')).toHaveClass('filey-button--small');
  });
});
