import { Skeleton, SkeletonCard } from '@/components/ui/skeleton';

export default function AskLoading() {
  return (
    <div className="mx-auto flex max-w-6xl gap-4">
      <div className="min-w-0 flex-1 space-y-3">
        <SkeletonCard height="h-48" />
        <Skeleton className="h-20 w-full" />
      </div>
      <div className="w-80 shrink-0">
        <SkeletonCard height="h-80" />
      </div>
    </div>
  );
}
