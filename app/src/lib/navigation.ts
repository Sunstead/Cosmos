import {
  Activity,
  Archive,
  ChartLine,
  Container,
  Database,
  HeartPulse,
  Hexagon,
  LayoutDashboard,
  Logs,
  Network,
  Orbit,
  PackageCheck,
  Server,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import type { ShortcutId } from './shortcuts';

export type PagePath =
  | '/overview'
  | '/constellation'
  | '/nodes'
  | '/services'
  | '/containers'
  | '/volumes'
  | '/network'
  | '/monitoring'
  | '/uptime'
  | '/logs'
  | '/backups'
  | '/updates'
  | '/events'
  | '/settings';

export interface PageDef {
  path: PagePath;
  label: string;
  icon: LucideIcon;
  shortcut: ShortcutId;
}

export const PAGES: PageDef[] = [
  { path: '/overview', label: 'Overview', icon: LayoutDashboard, shortcut: 'go.overview' },
  { path: '/constellation', label: 'Constellation', icon: Orbit, shortcut: 'go.constellation' },
  { path: '/nodes', label: 'Nodes', icon: Server, shortcut: 'go.nodes' },
  { path: '/services', label: 'Services', icon: Hexagon, shortcut: 'go.services' },
  { path: '/containers', label: 'Containers', icon: Container, shortcut: 'go.containers' },
  { path: '/volumes', label: 'Volumes', icon: Database, shortcut: 'go.volumes' },
  { path: '/network', label: 'Network', icon: Network, shortcut: 'go.network' },
  { path: '/monitoring', label: 'Monitoring', icon: ChartLine, shortcut: 'go.monitoring' },
  { path: '/uptime', label: 'Uptime', icon: HeartPulse, shortcut: 'go.uptime' },
  { path: '/logs', label: 'Logs', icon: Logs, shortcut: 'go.logs' },
  { path: '/backups', label: 'Backups', icon: Archive, shortcut: 'go.backups' },
  { path: '/events', label: 'Events', icon: Activity, shortcut: 'go.events' },
  { path: '/updates', label: 'Updates', icon: PackageCheck, shortcut: 'go.updates' },
  { path: '/settings', label: 'Settings', icon: Settings, shortcut: 'settings' },
];

/** Settings isn't listed: it lives in the account menu at the foot of the sidebar. */
export const NAV_GROUPS: { label: string | null; paths: PagePath[] }[] = [
  { label: null, paths: ['/overview', '/constellation', '/nodes', '/services'] },
  { label: 'Infrastructure', paths: ['/containers', '/volumes', '/network'] },
  { label: 'Operations', paths: ['/monitoring', '/uptime', '/logs', '/events', '/updates', '/backups'] },
];

export function pageFor(pathname: string): PageDef | undefined {
  if (pathname === '/') return PAGES[0];
  return PAGES.find((p) => pathname === p.path || pathname.startsWith(`${p.path}/`));
}
