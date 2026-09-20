import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/resizable-sidebar';
import { Link, useLocation } from '@tanstack/react-router';
import {
  Archive,
  ChartLine,
  Container,
  Database,
  Hexagon,
  LayoutDashboard,
  Logs,
  Network,
  Server,
  Settings,
} from 'lucide-react';
import { useNodeStore } from '@/stores/nodes';
import { Dot } from './dot';

/**
 * `/monitoring`, `/logs` and `/backups` had routes but no entry here, so they
 * were unreachable except by typing a URL.
 */
const NAV_GROUPS = [
  {
    label: null,
    items: [
      { label: 'Overview', icon: LayoutDashboard, href: '/overview' },
      { label: 'Nodes', icon: Server, href: '/nodes' },
      { label: 'Services', icon: Hexagon, href: '/services' },
    ],
  },
  {
    label: 'Infrastructure',
    items: [
      { label: 'Containers', icon: Container, href: '/containers' },
      { label: 'Volumes', icon: Database, href: '/volumes' },
      { label: 'Network', icon: Network, href: '/network' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { label: 'Monitoring', icon: ChartLine, href: '/monitoring' },
      { label: 'Logs', icon: Logs, href: '/logs' },
      { label: 'Backups', icon: Archive, href: '/backups' },
    ],
  },
  {
    label: null,
    items: [{ label: 'Settings', icon: Settings, href: '/settings' }],
  },
] as const;

/**
 * Prefix matching, not equality.
 *
 * `/nodes/$nodeId` should keep "Nodes" highlighted; exact comparison meant any
 * nested route silently deselected its parent.
 */
function isActive(pathname: string, href: string): boolean {
  if (href === '/overview') return pathname === '/' || pathname.startsWith('/overview');
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppSidebar() {
  const { pathname } = useLocation();
  const nodes = useNodeStore((s) => s.nodes);
  const onlineNodes = useNodeStore((s) => s.onlineNodes);

  const allOnline = nodes.length > 0 && onlineNodes === nodes.length;

  return (
    <Sidebar collapsible='icon'>
      <SidebarContent>
        {NAV_GROUPS.map((group, i) => (
          <SidebarGroup key={group.label ?? `group-${i}`} className='pl-0'>
            {group.label && (
              <SidebarGroupLabel className='pl-5 label-hud text-[10px]'>
                {group.label}
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map(({ label, icon: Icon, href }) => (
                  <SidebarMenuItem key={label}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive(pathname, href)}
                      className='rounded-l-none data-[active=true]:shadow-[inset_2px_0_0_0_var(--color-primary)] space-x-3 pl-5'
                      size='lg'
                    >
                      <Link to={href}>
                        <Icon className='size-5!' />
                        <span>{label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        {nodes.length > 0 && (
          <div className='flex items-center gap-2 px-5 py-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden'>
            <Dot variant={allOnline ? 'success' : 'error'} pulse={allOnline} />
            <span className='tabular-nums'>
              {onlineNodes}/{nodes.length} node{nodes.length === 1 ? '' : 's'} online
            </span>
          </div>
        )}
      </SidebarFooter>
      <SidebarRail className='mt-3' />
    </Sidebar>
  );
}
