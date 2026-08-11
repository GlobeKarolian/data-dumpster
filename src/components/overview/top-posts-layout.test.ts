import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const root = process.cwd();

describe('top-post gallery containment', () => {
  it('bounds the content beside the sidebar without hiding overflow', () => {
    const shell = readFileSync(resolve(root, 'src/components/shell/app-shell.tsx'), 'utf8');
    const topbar = readFileSync(resolve(root, 'src/components/shell/topbar.tsx'), 'utf8');

    assert.match(shell, /flex w-0 min-w-0 max-w-full flex-1 flex-col/);
    assert.doesNotMatch(shell, /flex w-full min-w-0 max-w-full flex-1 flex-col/);
    assert.doesNotMatch(shell, /overflow-x-clip/);
    assert.match(topbar, /overflow-x-auto/);
    assert.match(topbar, /sm:flex-wrap/);
    assert.match(topbar, /sm:overflow-visible/);
    assert.match(topbar, /sm:hidden/);
  });

  it('keeps polling progress from resizing or horizontally scrolling the desktop toolbar', () => {
    const refreshButton = readFileSync(
      resolve(root, 'src/components/shell/refresh-button.tsx'),
      'utf8',
    );

    assert.match(refreshButton, /relative w-\[12\.25rem\] shrink-0/);
    assert.match(refreshButton, /w-full justify-center whitespace-nowrap/);
  });

  it('chooses columns from the panel width instead of the viewport width', () => {
    const gallery = readFileSync(resolve(root, 'src/components/overview/top-posts.tsx'), 'utf8');

    assert.match(gallery, /repeat\(auto-fit,minmax\(min\(100%,32rem\),1fr\)\)/);
    assert.doesNotMatch(gallery, /(?:md|lg|xl|2xl):grid-cols-/);
  });

  it('shows the complete social creative instead of cropping it into a banner', () => {
    const card = readFileSync(resolve(root, 'src/components/posts/post-card.tsx'), 'utf8');

    assert.match(card, /aspect-\[4\/3\]/);
    assert.match(card, /relative z-10 h-full w-full object-contain/);
  });

  it('does not reserve a large black media box after a preview fails', () => {
    const card = readFileSync(resolve(root, 'src/components/posts/post-card.tsx'), 'utf8');

    assert.match(card, /previewUrl && !previewFailed/);
    assert.doesNotMatch(card, /No media preview available/);
  });
});
