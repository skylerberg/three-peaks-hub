import { render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { describe, expect, it } from 'vitest';
import Button from './Button.svelte';

const label = (text: string) => createRawSnippet(() => ({ render: () => `<span>${text}</span>` }));

describe('Button', () => {
  it('renders its children and defaults to type=button', () => {
    render(Button, { props: { children: label('Save') } });
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeInTheDocument();
    // Defaulting to submit inside a form is how a button that was meant to open
    // a menu submits the page instead.
    expect(button).toHaveAttribute('type', 'button');
  });

  it('carries a 44px minimum touch target', () => {
    render(Button, { props: { children: label('Tap') } });
    expect(screen.getByRole('button')).toHaveClass('min-h-11');
  });

  it('can be disabled', () => {
    render(Button, { props: { children: label('Wait'), disabled: true } });
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
