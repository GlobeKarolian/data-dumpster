import type { Metadata } from 'next';
import { PostsBoard } from '@/components/publishing/posts-board';

export const metadata: Metadata = { title: 'Posts' };

export default function PublishPostsPage() {
  return <PostsBoard />;
}
