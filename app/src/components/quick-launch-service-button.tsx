import { memo } from 'react';
import { ServiceInfo } from '@/lib/services';
import { ServiceIcon } from '@/lib/service-icons';
import { serviceHref } from '@/lib/agent-url';
import { openExternal } from '@/lib/open-external';
import { getServiceStatusDisplay } from '@/lib/service-utils';
import { Button } from './ui/button';
import { Dot } from './dot';

export const QuickLaunchServiceButton = memo(function QuickLaunchServiceButton({
  serviceInfo,
}: {
  serviceInfo: ServiceInfo;
}) {
  // Docker labels hold bare hostnames like `portainer.jupiter.sunstead.net`.
  // As an href that is a *relative path*, so the old anchor navigated the app
  // to /portainer.jupiter.sunstead.net instead of opening the service.
  const href = serviceHref(serviceInfo.url);
  const status = getServiceStatusDisplay(serviceInfo.status);

  return (
    <Button
      variant='secondary'
      disabled={!href}
      title={href ?? `${serviceInfo.name} has no cosmos.service.url label`}
      onClick={() => href && openExternal(href)}
      className='relative flex h-auto flex-col items-center gap-1.5 p-3'
    >
      <Dot variant={status.dotVariant} className='absolute top-1.5 right-1.5' />
      <ServiceIcon service={serviceInfo.key} size={24} />
      <span className='text-xs truncate max-w-full'>{serviceInfo.name}</span>
    </Button>
  );
});

export default QuickLaunchServiceButton;
