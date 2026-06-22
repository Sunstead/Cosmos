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
  { label: 'Overview', icon: LayoutDashboard, href: '#' },
  { label: 'Nodes', icon: Server, href: '#' },
  { label: 'Services', icon: Hexagon, href: '#' },
  { label: 'Volumes', icon: Database, href: '#' },
  { label: 'Network', icon: Network, href: '#' },
  { label: 'Monitoring', icon: Activity, href: '#' },
  { label: 'Logs', icon: FileText, href: '#' },
  { label: 'Backups', icon: Archive, href: '#' },
  { label: 'Settings', icon: Settings, href: '#' },
] as const;

export function AppSidebar() {
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
                    isActive={i === 0}
                    className='rounded-l-none data-[active=true]:shadow-[inset_2px_0_0_0_var(--color-primary)] space-x-3 pl-5'
                    size='lg'
                  >
                    <a href={href}>
                      <Icon className='size-5!' />
                      <span>{label}</span>
                    </a>
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
