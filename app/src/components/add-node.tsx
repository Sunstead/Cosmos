import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { CirclePlus } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Field, FieldLabel } from './ui/field';
import { useNodeStore } from '@/stores/nodes';
import { useState } from 'react';

// Stable ID links the <form> to the submit button that lives outside it in DialogFooter.
const FORM_ID = 'add-node-form';

export default function AddNode() {
  const [url, setUrl] = useState('');
  const [open, setOpen] = useState(false);
  const { addNode } = useNodeStore();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    addNode(url);
    setUrl('');
    setOpen(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) setUrl('');
    setOpen(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size='lg' className='gap-2'>
          <CirclePlus />
          Add Node
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Node</DialogTitle>
          <DialogDescription>
            Add a node to your Cosmos Constellation.
          </DialogDescription>
        </DialogHeader>

        <form id={FORM_ID} onSubmit={handleSubmit}>
          <Field>
            <FieldLabel htmlFor='node-url'>Node URL</FieldLabel>
            <Input
              id='node-url'
              type='url'
              placeholder='https://'
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              autoComplete='url'
              required
            />
          </Field>
        </form>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant='outline'>Cancel</Button>
          </DialogClose>

          <Button form={FORM_ID} type='submit' className='min-w-18'>
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
