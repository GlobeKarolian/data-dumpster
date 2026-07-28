import { Skeleton, SkeletonCard, SkeletonTable } from '@/components/ui/skeleton';

export default function PostsLoading() {
  return (
    <div className="space-y-4">
      <SkeletonCard height="h-72" />
      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="w-full space-y-3 lg:w-56">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
        <div className="min-w-0 flex-1">
          <SkeletonTable rows={10} cols={6} />
        </div>
      </div>
    </div>
  );
}
