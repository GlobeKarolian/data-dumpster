import { Skeleton, SkeletonTable } from '@/components/ui/skeleton';

export default function ReportsLoading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-4 w-44" />
      <Skeleton className="h-3 w-full max-w-2xl" />
      <SkeletonTable rows={6} cols={3} />
    </div>
  );
}
