import { Skeleton, SkeletonTable } from '@/components/ui/skeleton';

export default function DashboardsLoading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-3 w-full max-w-2xl" />
      <SkeletonTable rows={5} cols={2} />
    </div>
  );
}
