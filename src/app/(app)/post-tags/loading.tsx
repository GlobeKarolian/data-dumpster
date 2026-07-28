import { Skeleton, SkeletonTable } from '@/components/ui/skeleton';

export default function PostTagsLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-4 w-48" />
      <SkeletonTable rows={8} cols={6} />
      <SkeletonTable rows={4} cols={2} />
    </div>
  );
}
