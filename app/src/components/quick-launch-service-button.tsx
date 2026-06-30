import { ServiceIcon } from '@/lib/service-icons';
import { Button } from './ui/button';
import { ServiceInfo } from '@/lib/services';

export function QuickLaunchServiceButton({
  serviceInfo,
}: {
  serviceInfo: ServiceInfo;
}) {
  return (
    <Button
      asChild
      variant='outline'
      className='flex items-center h-full gap-2 bg-muted/40 hover:bg-muted p-4 text-xs w-full group'
    >
      <a href={serviceInfo.url ?? '#'} rel='noopener' target='_blank'>
        <div className='flex flex-col items-center gap-2 w-full'>
          <ServiceIcon service={serviceInfo.key} className='size-10' />
          <div className='text-center w-full'>
            <p className='text-base group-hover:underline'>
              {serviceInfo.name}
            </p>
            <p className='truncate font-normal text-muted-foreground max-w-full'>
              {serviceInfo.url}
            </p>
          </div>
        </div>
      </a>
    </Button>
  );
}
