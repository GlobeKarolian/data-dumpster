import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { toUrlSearchParams } from '../_lib/context';
import type { SearchParamsInput } from '../_lib/data';

export const metadata: Metadata = { title: 'Social Posts' };

/**
 * Content Analysis used to be a second screen with a narrower filter contract,
 * so its numbers could disagree with the post library. Social Posts is now the
 * one canonical Rival IQ-style workflow. Old bookmarks keep their scope.
 */
export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  const query = toUrlSearchParams(await searchParams).toString();
  redirect(query ? `/posts?${query}` : '/posts');
}
