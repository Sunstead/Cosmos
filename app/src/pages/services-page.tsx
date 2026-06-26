import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardFooter,
  CardDescription,
  CardTitle,
} from '@/components/ui/card';
import { ServiceIcon } from '@/lib/service-icons';
import { ExternalLink, MoreVertical } from 'lucide-react';

export function ServicesPage() {
  return (
    <>
      <div>
        <h1 className='text-muted-foreground text-xl'>SERVICES</h1>
      </div>
      <div className='grid grid-cols-4'>
        <Card>
          <CardContent className='space-y-4'>
            <div className='flex gap-4'>
              <ServiceIcon service='immich' size={32} />
              <div>
                <CardTitle>Immich</CardTitle>
                <CardDescription className='text-xs'>
                  Image storage & sharing
                </CardDescription>
              </div>
              <Button variant='ghost' size='icon-lg' className='ml-auto'>
                <MoreVertical />
              </Button>
            </div>
            <div className='grid grid-cols-3'>
              <div className='text-center text-xs text-muted-foreground'>
                <p>UPTIME</p>
                <p className='text-success'>7d 2h 11m</p>
              </div>
              <div className='text-center text-xs text-muted-foreground'>
                <p>CPU</p>
                <p className='text-foreground'>5%</p>
              </div>
              <div className='text-center text-xs text-muted-foreground'>
                <p>MEMORY</p>
                <p className='text-foreground'>3.4 GB</p>
              </div>
            </div>
            <Button variant='secondary' className='flex items-center gap-2 bg-muted/40 p-4 text-xs w-full h-max'>
              <span className='tracking-wider text-muted-foreground'>
                CONTAINERS
              </span>
              <div className='flex flex-1 items-center gap-1.5 pl-1'>
                <div className='size-2 rounded-full bg-success' />
                <div className='size-2 rounded-full bg-success' />
                <div className='size-2 rounded-full bg-success' />
                <div className='size-2 rounded-full bg-muted-foreground/25' />
              </div>
              <span className='font-medium text-foreground'>3 / 4</span>
            </Button>
          </CardContent>
          <CardFooter>
            <div className='flex items-center gap-1'>
              <Button variant='outline' asChild>
                <a
                  rel='noopener'
                  href='https://immich.jupiter.sunstead.net'
                  target='_blank'
                  className='flex items-center gap-1'
                >
                  Open
                  <ExternalLink />
                </a>
              </Button>
            </div>
          </CardFooter>
        </Card>
      </div>
    </>
  );
}
