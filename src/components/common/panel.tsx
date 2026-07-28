import * as React from 'react';
import type { MetricKey } from '@/lib/types';
import { Card, CardBody, CardHeader, CardNote, CardTitle, CardToolbar } from '@/components/ui/card';
import { MetricLabel } from '@/components/ui/metric-label';
import { ErrorState } from '@/components/ui/error-state';

export interface PanelProps {
  title: React.ReactNode;
  /** When set, the title carries the metric's definition tooltip. */
  metric?: MetricKey;
  description?: React.ReactNode;
  toolbar?: React.ReactNode;
  /** Rendered as a hairline note under the body. Use for denominators. */
  note?: React.ReactNode;
  error?: string | null;
  bodyClassName?: string;
  className?: string;
  children: React.ReactNode;
}

/**
 * A titled card. When the panel is about a single metric, pass `metric` and the
 * heading picks up the definition tooltip automatically, which is how the rule
 * that every number explains itself survives contact with fifty screens.
 */
export function Panel({
  title,
  metric,
  description,
  toolbar,
  note,
  error,
  bodyClassName,
  className,
  children,
}: PanelProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>
            {metric ? <MetricLabel metric={metric} text={typeof title === 'string' ? title : undefined} /> : title}
          </CardTitle>
          {description ? (
            <p className="mt-0.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{description}</p>
          ) : null}
        </div>
        {toolbar ? <CardToolbar>{toolbar}</CardToolbar> : null}
      </CardHeader>
      {error ? (
        <ErrorState compact message={error} />
      ) : (
        <CardBody className={bodyClassName}>{children}</CardBody>
      )}
      {!error && note ? <CardNote>{note}</CardNote> : null}
    </Card>
  );
}
