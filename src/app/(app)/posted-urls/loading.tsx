import { Skeleton, SkeletonTable } from '@/components/ui/skeleton';

export default function PostedUrlsLoading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-3 w-full max-w-3xl" />
      <SkeletonTable rows={12} cols={5} />
    </div>
  );
}
