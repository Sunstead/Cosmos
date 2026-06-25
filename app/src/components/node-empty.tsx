import { ServerOff } from "lucide-react";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "./ui/empty";
import AddNode from "./add-node";

export default function NodeEmpty() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant='icon'>
          <ServerOff />
        </EmptyMedia>
        <EmptyTitle>No Nodes Configured</EmptyTitle>
        <EmptyDescription>
          You haven&apos;t added any nodes yet. Get started by adding
          your first node.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className='flex-row justify-center gap-2'>
        <AddNode />
      </EmptyContent>
    </Empty>
  );
}
