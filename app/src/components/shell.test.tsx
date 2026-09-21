import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useUiStore } from '@/stores/ui';
import { DEFAULT_META, useNodeStore } from '@/stores/nodes';
import { useContainersStore } from '@/stores/containers';
import { containerInfo } from '@/test/fixtures';
import { TitleBar } from './title-bar';
import { CommandPalette } from './command-palette';

const navigate = vi.fn();
const toggleSidebar = vi.fn();
const toggleTheme = vi.fn();
const run = vi.fn();
let pathname = '/nodes';

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useLocation: () => ({ pathname }),
  Link: ({ children, to, ...rest }: { children: React.ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/ui/resizable-sidebar', () => ({ useSidebar: () => ({ toggleSidebar }) }));
vi.mock('@/components/theme-provider', () => ({
  useTheme: () => ({ toggleTheme, resolvedTheme: 'dark', theme: 'dark', setTheme: vi.fn() }),
}));
vi.mock('@/api/queries', () => ({ useContainerActions: () => ({ run, runMany: vi.fn(), pending: false }) }));
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
  pathname = '/nodes';
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

  it('shows the node in the breadcrumb on a detail page', () => {
    seedNode();
    pathname = '/nodes/n1';
    wrap(<TitleBar />);
    const crumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumb).getByRole('link', { name: 'Nodes' })).toBeInTheDocument();
    expect(crumb).toHaveTextContent('jupiter');
  });

  it('opens the palette from the search trigger and toggles the sidebar', async () => {
    wrap(<TitleBar />);
    await userEvent.click(screen.getByRole('button', { name: /search or jump to/i }));
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
