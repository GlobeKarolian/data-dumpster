import { Skeleton, SkeletonCard } from '@/components/ui/skeleton';

export default function SettingsLoading() {
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Skeleton className="h-4 w-56" />
      <Skeleton className="h-3 w-full max-w-3xl" />
      <SkeletonCard height="h-40" />
      <SkeletonCard height="h-64" />
    </div>
  );
}
