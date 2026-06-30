import { ServiceCard } from '@/components/service-card';
import { useContainersStore } from '@/stores/containers';

export function ServicesPage() {
  const services = useContainersStore((s) => s.services);

  return (
    <>
      <div className='min-h-9 flex items-center'>
        <h1 className='text-muted-foreground text-xl'>SERVICES</h1>
      </div>
      <div className='grid grid-cols-[repeat(auto-fill,minmax(350px,1fr))] gap-4'>
        {services
          .filter((service) => service.key !== 'system')
          .map((service) => (
            <ServiceCard serviceInfo={service} />
          ))}
      </div>
    </>
  );
}
