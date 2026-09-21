import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Cpu, Grid2x2, List, ServerOff } from 'lucide-react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { PageHeader } from './page-header';
import { StatCard } from './stat-card';
import { EmptyState, NoNodesState } from './empty-state';
import { SegmentedControl } from './segmented-control';
import { SetupHint } from './setup-hint';
import { ConfirmDialog } from './confirm-dialog';
import { useUiStore } from '@/stores/ui';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const wrap = (ui: React.ReactNode) => render(<TooltipProvider>{ui}</TooltipProvider>);

describe('PageHeader', () => {
  it('renders title, count and actions', () => {
    wrap(<PageHeader title='Containers' count={3} actions={<button>Refresh</button>} />);
    expect(screen.getByRole('heading', { name: 'Containers' })).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(document.querySelector('[data-page-actions]')).toContainElement(
      screen.getByRole('button', { name: 'Refresh' }),
    );
  });

  it('omits the actions slot when empty', () => {
    wrap(<PageHeader title='Logs' />);
    expect(document.querySelector('[data-page-actions]')).toBeNull();
  });
});

describe('StatCard', () => {
  it('renders no sublabel row when unset', () => {
    wrap(<StatCard label='CPU' value='12%' icon={Cpu} />);
    const card = document.querySelector('[data-stat-card]')!;
    expect(card.querySelectorAll('p')).toHaveLength(2);
  });

  it('shows a skeleton instead of the value while loading', () => {
    wrap(<StatCard label='CPU' value='12%' sublabel='avg' icon={Cpu} loading />);
    expect(screen.queryByText('12%')).toBeNull();
    expect(screen.queryByText('avg')).toBeNull();
  });
});

describe('EmptyState', () => {
  it('drops the icon in the inline size', () => {
    const { container } = wrap(<EmptyState icon={ServerOff} title='Nothing' size='inline' />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('adds a setup hint when given setup info', () => {
    wrap(<EmptyState icon={ServerOff} title='No history' setup={{ summary: 'Enable it.' }} />);
    expect(screen.getByRole('button', { name: 'How to enable' })).toBeInTheDocument();
  });

  it('no-nodes state opens the add node dialog', async () => {
    useUiStore.setState({ addNodeOpen: false });
    wrap(<NoNodesState />);
    await userEvent.click(screen.getByRole('button', { name: 'Add node' }));
    expect(useUiStore.getState().addNodeOpen).toBe(true);
  });
});

describe('SegmentedControl', () => {
  function Harness({ onChange }: { onChange?: (v: string) => void }) {
    const [value, setValue] = useState<'grid' | 'list'>('grid');
    return (
      <SegmentedControl
        label='View'
        value={value}
        onChange={(v) => {
          setValue(v);
          onChange?.(v);
        }}
        options={[
          { value: 'grid', icon: Grid2x2, hint: 'Grid' },
          { value: 'list', icon: List, hint: 'List' },
        ]}
      />
    );
  }

  it('marks the active option and switches on click', async () => {
    wrap(<Harness />);
    const grid = screen.getByRole('radio', { name: 'Grid' });
    const list = screen.getByRole('radio', { name: 'List' });
    expect(grid).toHaveAttribute('aria-checked', 'true');

    await userEvent.click(list);
    expect(list).toHaveAttribute('aria-checked', 'true');
    expect(grid).toHaveAttribute('aria-checked', 'false');
  });

  it('cannot be deselected', async () => {
    const onChange = vi.fn();
    wrap(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Grid' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: 'Grid' })).toHaveAttribute('aria-checked', 'true');
  });

  it('moves between options with arrow keys', async () => {
    wrap(<Harness />);
    screen.getByRole('radio', { name: 'Grid' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'List' })).toHaveFocus();
  });
});

describe('SetupHint', () => {
  it('reveals the snippet and copies it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    wrap(<SetupHint info={{ summary: 'Turn it on.', file: 'agent.toml', snippet: 'a = 1' }} />);
    await userEvent.click(screen.getByRole('button', { name: 'How to enable' }));

    expect(await screen.findByText('Turn it on.')).toBeInTheDocument();
    expect(screen.getByText('agent.toml')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('a = 1');
  });
});

describe('ConfirmDialog', () => {
  it('uncontrolled: opens from its trigger and closes after confirming', async () => {
    const onConfirm = vi.fn();
    wrap(
      <ConfirmDialog
        title='Remove node?'
        description='This cannot be undone.'
        confirmLabel='Remove'
        onConfirm={onConfirm}
        trigger={<button>Remove</button>}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Remove node?');

    await userEvent.click(screen.getAllByRole('button', { name: 'Remove' }).at(-1)!);
    expect(onConfirm).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('controlled: reports close on cancel without confirming', async () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    wrap(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title='Stop container?'
        description='It will stop.'
        onConfirm={onConfirm}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('stays open when the action throws', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('nope'));
    wrap(
      <ConfirmDialog open title='Remove?' description='x' onConfirm={onConfirm} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled();
  });
});
