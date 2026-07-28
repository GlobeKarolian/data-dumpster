import { Skeleton, SkeletonCard, SkeletonStatRow } from '@/components/ui/skeleton';

export default function CrossChannelLoading() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-4 w-56" />
        <Skeleton className="mt-2 h-3 w-96" />
      </div>
      <SkeletonStatRow />
      <div className="grid gap-3 xl:grid-cols-2">
        <SkeletonCard height="h-56" />
        <SkeletonCard height="h-56" />
        <SkeletonCard height="h-56" />
        <SkeletonCard height="h-56" />
      </div>
      <div className="grid gap-3 xl:grid-cols-3">
        <SkeletonCard className="xl:col-span-2" />
        <SkeletonCard />
      </div>
    </div>
  );
}
