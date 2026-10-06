// Adapted from old daemons-run resources/js/components/AppIllustration.tsx
import { cn } from '@/lib/utils';

export const APP_ILLUSTRATION_NAMES = [
    'app-empty-daemons',
    'app-creating',
    'app-empty-notifications',
    'app-signin',
    'app-not-found',
    'app-empty-previews',
    'app-agent-unsupported',
    'app-api-connect',
] as const;

export type AppIllustrationName = (typeof APP_ILLUSTRATION_NAMES)[number];

export type AppIllustrationSize = 'sm' | 'md' | 'lg';

const sizeWidthPx: Record<AppIllustrationSize, number> = {
    sm: 160,
    md: 240,
    lg: 320,
};

export function isAppIllustrationName(
    value: unknown,
): value is AppIllustrationName {
    return (
        typeof value === 'string' &&
        (APP_ILLUSTRATION_NAMES as readonly string[]).includes(value)
    );
}

export type AppIllustrationProps = {
    name: AppIllustrationName;
    size?: AppIllustrationSize;
    className?: string;
};

function illustrationSrc(
    name: AppIllustrationName,
    theme: 'light' | 'dark',
): string {
    return `/images/app/${name}-${theme}@2x.webp`;
}

export function AppIllustration({
    name,
    size = 'md',
    className,
}: Readonly<AppIllustrationProps>) {
    const width = sizeWidthPx[size];
    const height = Math.round((width * 2) / 3);

    return (
        <span
            aria-hidden
            data-testid="app-illustration"
            data-illustration={name}
            data-size={size}
            className={cn('inline-flex shrink-0', className)}
            style={{ width }}
        >
            <img
                src={illustrationSrc(name, 'light')}
                width={width}
                height={height}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-auto w-full dark:hidden"
            />
            <img
                src={illustrationSrc(name, 'dark')}
                width={width}
                height={height}
                alt=""
                loading="lazy"
                decoding="async"
                className="hidden h-auto w-full dark:block"
            />
        </span>
    );
}
