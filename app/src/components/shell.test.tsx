import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useUiStore } from '@/stores/ui';
import { DEFAULT_META, useNodeStore } from '@/stores/nodes';
import { useContainersStore } from '@/stores/containers';
import { containerInfo, wolEntry } from '@/test/fixtures';
import type { WolItem } from '@/api/queries';
import { TitleBar } from './title-bar';
import { CommandPalette } from './command-palette';
import { CommandHost } from './command-host';

const navigate = vi.fn();
const toggleSidebar = vi.fn();
const toggleTheme = vi.fn();
const run = vi.fn();
const wake = vi.fn();
let wolItems: WolItem[] = [];

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  Link: ({ children, to, ...rest }: { children: React.ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/ui/resizable-sidebar', () => ({ useSidebar: () => ({ toggleSidebar }) }));
vi.mock('@/hooks/use-theme', () => ({
  useTheme: () => ({ toggleTheme, resolvedTheme: 'dark', theme: 'dark', setTheme: vi.fn() }),
}));
vi.mock('@/api/queries', () => ({
  useContainerActions: () => ({ run, runMany: vi.fn(), pending: false }),
  useWol: () => ({ items: wolItems, networks: {}, nodes: ['n1'], loading: false, error: null }),
  useWolActions: () => ({ wake, save: vi.fn(), remove: vi.fn(), pending: null }),
}));
vi.mock('./node-planet', () => ({ NodeAvatar: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const wrap = (ui: React.ReactNode) => render(<TooltipProvider>{ui}</TooltipProvider>);

function seedNode(online = true) {
  useNodeStore.setState({
    nodes: [{ id: 'n1', url: 'http://jupiter:7700', agentName: 'jupiter', alias: null }],
    meta: {
      n1: {
        ...DEFAULT_META,
        status: online ? 'online' : 'offline',
        capabilities: { ...DEFAULT_META.capabilities, container_actions: true },
      },
    },
    onlineNodes: online ? 1 : 0,
  });
}

beforeEach(() => {
  navigate.mockClear();
  run.mockClear();
  useUiStore.setState({ paletteOpen: false, addNodeOpen: false });
  useNodeStore.setState({ nodes: [], meta: {}, onlineNodes: 0 });
  useContainersStore.setState({ nodeContainers: {}, nodeServices: {}, services: [] });
});

describe('TitleBar', () => {
  it('shows window controls only on Windows and Linux', () => {
    for (const platform of ['windows', 'linux'] as const) {
      document.documentElement.dataset.platform = platform;
      const { unmount } = wrap(<TitleBar />);
      expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Minimize' })).toBeInTheDocument();
      unmount();
    }
  });

  it('has no window controls on macOS or the web', () => {
    for (const platform of ['macos', 'web'] as const) {
      document.documentElement.dataset.platform = platform;
      const { unmount, container } = wrap(<TitleBar />);
      expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
      expect(container.querySelector('.titlebar-inset')).not.toBeNull();
      unmount();
    }
  });

  it('is a drag region', () => {
    const { container } = wrap(<TitleBar />);
    expect(container.querySelector('header')).toHaveAttribute('data-tauri-drag-region', 'deep');
  });

  it('keeps constant chrome instead of echoing the page title', () => {
    seedNode();
    wrap(<TitleBar />);
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull();
    expect(screen.queryByText('jupiter')).toBeNull();
  });

  it('opens the palette from the search trigger and toggles the sidebar', async () => {
    wrap(<TitleBar />);
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(useUiStore.getState().paletteOpen).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Toggle sidebar' }));
    expect(toggleSidebar).toHaveBeenCalled();
  });

  it('shows the online count once nodes exist', () => {
    seedNode(false);
    wrap(<TitleBar />);
    expect(screen.getByText('0/1')).toBeInTheDocument();
  });
});

describe('CommandPalette', () => {
  const open = () => useUiStore.setState({ paletteOpen: true });

  it('navigates to a page and closes', async () => {
    open();
    wrap(<CommandPalette />);
    await userEvent.click(await screen.findByRole('option', { name: /Containers/ }));
    expect(navigate).toHaveBeenCalledWith({ to: '/containers' });
    expect(useUiStore.getState().paletteOpen).toBe(false);
  });

  it('offers to wake a sleeping machine, not an awake one', async () => {
    seedNode();
    useNodeStore.setState((s) => ({
      meta: { n1: { ...s.meta.n1, capabilities: { ...s.meta.n1.capabilities, wol: true, wol_actions: true } } },
    }));
    wolItems = [
      { ...wolEntry(), nodeId: 'n1' },
      { ...wolEntry({ state: 'awake', target: { ...wolEntry().target, id: '2', name: 'laptop' } }), nodeId: 'n1' },
    ];
    open();
    wrap(<CommandPalette />);

    await userEvent.click(await screen.findByRole('option', { name: /Wake desktop/ }));
    expect(wake).toHaveBeenCalledWith('n1', '1', 'desktop');
    expect(screen.queryByRole('option', { name: /Wake laptop/ })).toBeNull();
    wolItems = [];
  });

  it('filters by typed text', async () => {
    open();
    wrap(<CommandPalette />);
    await userEvent.type(await screen.findByRole('combobox'), 'theme');
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('Toggle theme');
  });

  it('shows nodes and opens a container sub-page with actions', async () => {
    seedNode();
    useContainersStore.getState().setNodeContainers('n1', [containerInfo()]);
    open();
    wrap(<CommandPalette />);

    expect(await screen.findByRole('option', { name: /jupiter/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('option', { name: /gitea/ }));

    expect(screen.getByRole('option', { name: /Restart/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /^Start/ })).toBeNull();
    await userEvent.click(screen.getByRole('option', { name: /Restart/ }));
    expect(run).toHaveBeenCalledWith('c1', 'restart', 'gitea');
  });

  it('hides container actions without the capability', async () => {
    seedNode();
    useNodeStore.setState((s) => ({
      meta: { n1: { ...s.meta.n1, capabilities: { ...s.meta.n1.capabilities, container_actions: false } } },
    }));
    useContainersStore.getState().setNodeContainers('n1', [containerInfo()]);
    open();
    wrap(<CommandPalette />);

    await userEvent.click(await screen.findByRole('option', { name: /gitea/ }));
    expect(screen.getByRole('option', { name: /View logs/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Restart/ })).toBeNull();
  });

  it('Backspace on an empty input leaves the sub-page', async () => {
    seedNode();
    useContainersStore.getState().setNodeContainers('n1', [containerInfo()]);
    open();
    wrap(<CommandPalette />);

    await userEvent.click(await screen.findByRole('option', { name: /gitea/ }));
    await userEvent.type(screen.getByRole('combobox'), '{Backspace}');
    expect(screen.getByRole('option', { name: /Add node/ })).toBeInTheDocument();
  });

  it('deep-links container logs', async () => {
    seedNode();
    useContainersStore.getState().setNodeContainers('n1', [containerInfo()]);
    open();
    wrap(<CommandPalette />);

    await userEvent.click(await screen.findByRole('option', { name: /gitea/ }));
    await userEvent.click(screen.getByRole('option', { name: /View logs/ }));
    expect(navigate).toHaveBeenCalledWith({ to: '/logs', search: { node: 'n1', container: 'c1' } });
  });
});

describe('CommandHost', () => {
  beforeEach(() => {
    document.documentElement.dataset.platform = 'web';
  });

  it('goes to a page on "G then a letter"', async () => {
    render(<CommandHost />);
    await userEvent.keyboard('gl');
    expect(navigate).toHaveBeenCalledWith({ to: '/logs' });
    await userEvent.keyboard('gp');
    expect(navigate).toHaveBeenLastCalledWith({ to: '/updates' });
  });

  it('leaves typing alone', async () => {
    render(
      <>
        <CommandHost />
        <input aria-label='field' />
      </>,
    );
    await userEvent.click(screen.getByRole('textbox', { name: 'field' }));
    await userEvent.keyboard('gl');
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'field' })).toHaveValue('gl');
  });

  it('no longer jumps to pages on number keys', async () => {
    render(<CommandHost />);
    await userEvent.keyboard('{Control>}1{/Control}');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('still toggles the sidebar with its chord', async () => {
    render(<CommandHost />);
    await userEvent.keyboard('{Control>}b{/Control}');
    expect(toggleSidebar).toHaveBeenCalled();
  });
});
