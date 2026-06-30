import { ComponentType, SVGProps } from 'react';
import { Server } from 'lucide-react';

import GiteaIcon from '@/assets/icons/gitea.svg?react';
import NextcloudIcon from '@/assets/icons/nextcloud.svg?react';
import ImmichIcon from '@/assets/icons/immich.svg?react';
import UptimeKumaIcon from '@/assets/icons/uptime-kuma.svg?react';
import PortainerIcon from '@/assets/icons/portainer-dark.svg?react';
import TailscaleIcon from '@/assets/icons/tailscale-light.svg?react';

type SvgComponent = ComponentType<SVGProps<SVGSVGElement>>;

const ICONS: Record<string, SvgComponent> = {
  gitea: GiteaIcon,
  nextcloud: NextcloudIcon,
  immich: ImmichIcon,
  'uptime-kuma': UptimeKumaIcon,
  portainer: PortainerIcon,
  tailscale: TailscaleIcon,
};

interface ServiceIconProps extends SVGProps<SVGSVGElement> {
  service: string;
  size?: number;
}

export function ServiceIcon({
  service,
  size = 24,
  ...props
}: ServiceIconProps) {
  const Icon = ICONS[service.toLowerCase()];

  if (!Icon) {
    return <Server size={size} />;
  }

  return <Icon width={size} height={size} {...props} />;
}
