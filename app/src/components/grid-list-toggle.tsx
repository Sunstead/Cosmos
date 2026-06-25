import { Grid2X2, List } from 'lucide-react';
import { Button } from './ui/button';
import { ButtonGroup } from './ui/button-group';

export type GridListView = 'grid' | 'list';

export default function GridListToggle({
  view,
  onViewChange,
}: {
  view: GridListView;
  onViewChange: (v: GridListView) => void;
}) {
  return (
    <ButtonGroup>
      <Button
        size='lg'
        variant={view == 'grid' ? 'default' : 'outline'}
        onClick={() => onViewChange('grid')}
      >
        <Grid2X2 />
      </Button>
      <Button
        size='lg'
        variant={view == 'list' ? 'default' : 'outline'}
        onClick={() => onViewChange('list')}
      >
        <List />
      </Button>
    </ButtonGroup>
  );
}
