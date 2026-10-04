import { ReactElement, ReactNode, useState } from 'react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@sunstead/ui/components/dialog';
import { Button } from '@sunstead/ui/components/button';

interface Props {
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
  /** Uncontrolled: renders its own trigger. */
  trigger?: ReactElement;
  /** Controlled: for opening from a menu item that unmounts on select. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Confirmation for an action that can't be undone.
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel = 'Confirm',
  destructive = true,
  onConfirm,
  open: controlledOpen,
  onOpenChange,
}: Props) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (!isControlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
      setOpen(false);
    } catch {
      // The caller reports the error; stay open so the user can retry.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger render={trigger} />}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription render={<div className='text-sm text-muted-foreground' />}>
            {description}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant='outline' />}>Cancel</DialogClose>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={confirm}
            disabled={busy}
            className='min-w-24'
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
