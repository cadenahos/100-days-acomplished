import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConfirmDialog from './ConfirmDialog';

const setup = (props = {}) => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <ConfirmDialog
      open
      title="Delete this challenge?"
      message='"Morning run" will be permanently deleted.'
      detail="You'll lose 12 days of progress."
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    />
  );
  return { onConfirm, onCancel };
};

describe('ConfirmDialog', () => {
  it('renders nothing when closed', () => {
    render(<ConfirmDialog open={false} title="x" message="y" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('shows the title, message and detail', () => {
    setup();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('Delete this challenge?')).toBeInTheDocument();
    expect(screen.getByText(/Morning run/)).toBeInTheDocument();
    expect(screen.getByText(/12 days of progress/)).toBeInTheDocument();
  });

  // The safe action must be focused so a stray Enter cannot delete anything.
  it('focuses Cancel, not the destructive button', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Delete' })).not.toHaveFocus();
  });

  it('confirms when the destructive button is clicked', async () => {
    const user = userEvent.setup();
    const { onConfirm, onCancel } = setup();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('cancels via the Cancel button', async () => {
    const user = userEvent.setup();
    const { onConfirm, onCancel } = setup();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('cancels on Escape', async () => {
    const user = userEvent.setup();
    const { onCancel } = setup();

    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('cancels on a backdrop click but not on a click inside the panel', async () => {
    const user = userEvent.setup();
    const { onCancel } = setup();

    await user.click(screen.getByText('Delete this challenge?'));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('disables both buttons and shows progress while busy', () => {
    setup({ busy: true });

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Deleting/ })).toBeDisabled();
  });

  it('ignores Escape while a delete is in flight', async () => {
    const user = userEvent.setup();
    const { onCancel } = setup({ busy: true });

    await user.keyboard('{Escape}');
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('restores page scrolling when it closes', () => {
    const { unmount } = render(
      <ConfirmDialog open title="t" message="m" onConfirm={() => {}} onCancel={() => {}} />
    );
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('uses custom labels when provided', () => {
    setup({ confirmLabel: 'Yes, remove it', cancelLabel: 'Keep it' });
    expect(screen.getByRole('button', { name: 'Yes, remove it' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep it' })).toBeInTheDocument();
  });
});
