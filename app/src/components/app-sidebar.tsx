import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/resizable-sidebar';
import { Link, useLocation } from '@tanstack/react-router';
import {
  Activity,
  Archive,
  Database,
  FileText,
  Hexagon,
  LayoutDashboard,
  Network,
  Server,
  Settings,
} from 'lucide-react';

const NAV_ITEMS = [
  { label: 'Overview', icon: LayoutDashboard, href: '/overview' },
  { label: 'Nodes', icon: Server, href: '/nodes' },
  { label: 'Services', icon: Hexagon, href: '/services' },
  { label: 'Volumes', icon: Database, href: '/volumes' },
  { label: 'Network', icon: Network, href: '/network' },
  { label: 'Monitoring', icon: Activity, href: '/monitoring' },
  { label: 'Logs', icon: FileText, href: '/logs' },
  { label: 'Backups', icon: Archive, href: '/backups' },
  { label: 'Settings', icon: Settings, href: '/settings' },
] as const;

export function AppSidebar() {
  const location = useLocation();

  return (
    <Sidebar collapsible='icon'>
      {/* <SidebarHeader /> */}
      <SidebarContent>
        <SidebarGroup className='pl-0'>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map(({ label, icon: Icon, href }, i) => (
                <SidebarMenuItem key={label}>
                  <SidebarMenuButton
                    asChild
                    isActive={location.pathname == href}
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
      </SidebarContent>
      <SidebarFooter />
      <SidebarRail />
    </Sidebar>
  );
}
