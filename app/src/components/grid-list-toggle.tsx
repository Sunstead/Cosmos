import { Grid2X2, List } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';

export type GridListView = 'grid' | 'list';

export default function GridListToggle({
  view,
  onViewChange,
}: {
  view: GridListView;
  onViewChange: (v: GridListView) => void;
}) {
  return (
    <Tabs value={view} onValueChange={(v) => onViewChange(v as GridListView)}>
      <TabsList className='h-9!'>
        <TabsTrigger value="grid">
          <Grid2X2 />
        </TabsTrigger>
        <TabsTrigger value="list">
          <List />
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}