import { Skeleton, SkeletonTable } from '@/components/ui/skeleton';

export default function BriefsLoading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-3 w-full max-w-2xl" />
      <SkeletonTable rows={6} cols={2} />
    </div>
  );
}
