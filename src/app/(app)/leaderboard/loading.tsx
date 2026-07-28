import { Skeleton, SkeletonCard } from '@/components/ui/skeleton';

export default function LeaderboardLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-3 w-full max-w-3xl" />
      {[0, 1].map((group) => (
        <div key={group} className="space-y-3">
          <Skeleton className="h-4 w-40" />
          <div className="grid gap-3 xl:grid-cols-2">
            <SkeletonCard height="h-52" />
            <SkeletonCard height="h-52" />
          </div>
        </div>
      ))}
    </div>
  );
}
