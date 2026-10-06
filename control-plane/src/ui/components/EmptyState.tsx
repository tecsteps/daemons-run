// Adapted from old daemons-run resources/js/components/EmptyState.tsx
import type { ReactNode } from 'react';

import {
    AppIllustration,
    isAppIllustrationName,
} from '@/components/AppIllustration';
import { BrandMark } from '@/components/BrandMark';
import { cn } from '@/lib/utils';

export type EmptyStateDensity = 'page' | 'section';

export type EmptyStateProps = {
    title: string;
    description?: ReactNode;
    action?: ReactNode;
    illustration?: ReactNode;
    density?: EmptyStateDensity;
    /** Extra content under the actions, for example a copyable prompt. */
    children?: ReactNode;
    className?: string;
    testId?: string;
};

export function EmptyState({
    title,
    description,
    action,
    illustration,
    density = 'page',
    children,
    className,
    testId,
}: Readonly<EmptyStateProps>) {
    const compact = density === 'section';
    const namedIllustration = isAppIllustrationName(illustration);

    return (
        <div
            data-testid={testId ?? 'empty-state'}
            data-density={density}
            data-illustration={namedIllustration ? illustration : undefined}
            className={cn(
                'flex flex-col items-center justify-center gap-4 rounded-md border border-dashed border-line bg-surface text-center',
                compact ? 'px-4 py-5' : 'px-6 py-8 md:py-16',
                className,
            )}
        >
            {namedIllustration ? (
                <AppIllustration
                    name={illustration}
                    size={compact ? 'sm' : 'md'}
                />
            ) : (
                <div
                    className={cn(
                        'flex items-center justify-center',
                        compact ? 'h-10 w-10' : 'h-16 w-16',
                    )}
                >
                    {illustration ?? <BrandMark size={compact ? 32 : 48} />}
                </div>
            )}
            <div className="flex max-w-md flex-col gap-1.5">
                <h2
                    className={cn(
                        'font-sans font-bold text-ink-900',
                        compact ? 'text-card' : 'text-section',
                    )}
                >
                    {title}
                </h2>
                {description ? (
                    <p className="text-body text-muted">{description}</p>
                ) : null}
            </div>
            {action ? (
                <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
                    {action}
                </div>
            ) : null}
            {children ? (
                <div className="w-full max-w-2xl min-w-0 text-left">
                    {children}
                </div>
            ) : null}
        </div>
    );
}
