import { SkeletonCard, SkeletonStatRow } from '@/components/ui/skeleton';

export default function AppLoading() {
  return (
    <div className="space-y-6">
      <SkeletonStatRow />
      <div className="grid gap-3 xl:grid-cols-2">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
}
