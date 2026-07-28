import * as React from 'react';

/**
 * A small, deliberately limited markdown renderer.
 *
 * Briefs are model output. Rather than parse them into HTML and hand that to
 * dangerouslySetInnerHTML, this walks the source and builds React elements, so
 * there is no path from generated text to injected markup. The supported subset
 * is exactly what the brief prompt is allowed to emit: headings, paragraphs,
 * lists, blockquotes, emphasis, inline code and links.
 */

type Inline = React.ReactNode;

const INLINE_PATTERN = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;

function renderInline(text: string, keyPrefix: string): Inline[] {
  const parts = text.split(INLINE_PATTERN).filter((p) => p !== '');
  return parts.map((part, i) => {
    const key = keyPrefix + '-' + i;
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={key} className="font-semibold text-zinc-900 dark:text-zinc-100">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={key}
          className="pb-num rounded bg-zinc-100 px-1 py-0.5 text-[0.85em] text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link) {
      const href = link[2];
      const safe = href.startsWith('http://') || href.startsWith('https://') || href.startsWith('/');
      if (!safe) return <span key={key}>{link[1]}</span>;
      return (
        <a
          key={key}
          href={href}
          target={href.startsWith('/') ? undefined : '_blank'}
          rel="noopener noreferrer"
          className="text-accent-600 underline underline-offset-2 hover:no-underline dark:text-accent-500"
        >
          {link[1]}
        </a>
      );
    }
    return <React.Fragment key={key}>{part}</React.Fragment>;
  });
}

interface Block {
  kind: 'h1' | 'h2' | 'h3' | 'p' | 'ul' | 'ol' | 'quote' | 'hr';
  lines: string[];
}

function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  let buffer: Block | null = null;

  const flush = () => {
    if (buffer) blocks.push(buffer);
    buffer = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === '') {
      flush();
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      flush();
      blocks.push({ kind: 'hr', lines: [] });
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length;
      blocks.push({ kind: level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3', lines: [heading[2]] });
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      if (!buffer || buffer.kind !== 'ul') {
        flush();
        buffer = { kind: 'ul', lines: [] };
      }
      buffer.lines.push(bullet[1]);
      continue;
    }
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      if (!buffer || buffer.kind !== 'ol') {
        flush();
        buffer = { kind: 'ol', lines: [] };
      }
      buffer.lines.push(numbered[1]);
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      if (!buffer || buffer.kind !== 'quote') {
        flush();
        buffer = { kind: 'quote', lines: [] };
      }
      buffer.lines.push(quote[1]);
      continue;
    }
    if (!buffer || buffer.kind !== 'p') {
      flush();
      buffer = { kind: 'p', lines: [] };
    }
    buffer.lines.push(line);
  }
  flush();
  return blocks;
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks = React.useMemo(() => parseBlocks(source), [source]);

  return (
    <div className={className}>
      {blocks.map((block, i) => {
        const key = 'b' + i;
        if (block.kind === 'hr') {
          return <hr key={key} className="my-5 border-zinc-200 dark:border-zinc-800" />;
        }
        if (block.kind === 'h1') {
          return (
            <h2 key={key} className="mt-6 text-lg font-semibold tracking-tight text-zinc-900 first:mt-0 dark:text-zinc-50">
              {renderInline(block.lines[0], key)}
            </h2>
          );
        }
        if (block.kind === 'h2') {
          return (
            <h3 key={key} className="mt-5 text-sm font-semibold tracking-tight text-zinc-900 first:mt-0 dark:text-zinc-100">
              {renderInline(block.lines[0], key)}
            </h3>
          );
        }
        if (block.kind === 'h3') {
          return (
            <h4 key={key} className="mt-4 text-xs font-semibold uppercase tracking-wider text-zinc-500 first:mt-0">
              {renderInline(block.lines[0], key)}
            </h4>
          );
        }
        if (block.kind === 'quote') {
          return (
            <blockquote
              key={key}
              className="my-3 border-l-2 border-accent-600 pl-3 text-sm italic leading-relaxed text-zinc-600 dark:text-zinc-400"
            >
              {renderInline(block.lines.join(' '), key)}
            </blockquote>
          );
        }
        if (block.kind === 'ul' || block.kind === 'ol') {
          const List = block.kind === 'ul' ? 'ul' : 'ol';
          return (
            <List
              key={key}
              className={
                'my-3 space-y-1.5 pl-5 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300 ' +
                (block.kind === 'ul' ? 'list-disc' : 'list-decimal')
              }
            >
              {block.lines.map((line, j) => (
                <li key={key + '-' + j} className="pl-1">
                  {renderInline(line, key + '-' + j)}
                </li>
              ))}
            </List>
          );
        }
        return (
          <p key={key} className="my-3 text-sm leading-relaxed text-zinc-700 first:mt-0 dark:text-zinc-300">
            {renderInline(block.lines.join(' '), key)}
          </p>
        );
      })}
    </div>
  );
}
