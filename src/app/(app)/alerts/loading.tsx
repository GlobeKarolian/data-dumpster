import { SkeletonCard } from '@/components/ui/skeleton';

export default function AlertsLoading() {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <SkeletonCard height="h-72" />
      <SkeletonCard height="h-72" />
    </div>
  );
}
