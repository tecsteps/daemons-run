// Adapted from old daemons-run resources/js/components/BrandMark.tsx
import { cn } from '@/lib/utils';

type BrandMarkProps = {
    className?: string;
    size?: number;
};

/**
 * Rounded terminal rectangle with inward-facing `> <` eyes.
 * Must stay recognizable at 20–32px (styleguide §2).
 */
export function BrandMark({ className, size = 32 }: Readonly<BrandMarkProps>) {
    const height = size;
    const width = Math.round(size * 1.4);

    return (
        <svg
            width={width}
            height={height}
            viewBox="0 0 44 32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={cn('shrink-0', className)}
            aria-hidden
        >
            <rect
                x="1.4"
                y="1.4"
                width="41.2"
                height="29.2"
                rx="7"
                fill="#050708"
                stroke="#C4FF18"
                strokeWidth="2.4"
            />
            <path
                d="M9.2 10.2L16.4 16L9.2 21.8"
                stroke="#F5F1E8"
                strokeWidth="2.4"
                strokeLinecap="square"
                strokeLinejoin="miter"
            />
            <path
                d="M34.8 10.2L27.6 16L34.8 21.8"
                stroke="#F5F1E8"
                strokeWidth="2.4"
                strokeLinecap="square"
                strokeLinejoin="miter"
            />
        </svg>
    );
}

type WordmarkProps = {
    className?: string;
    showMark?: boolean;
    markSize?: number;
};

export function Wordmark({
    className,
    showMark = true,
    markSize = 28,
}: Readonly<WordmarkProps>) {
    return (
        <span
            className={cn(
                'inline-flex items-center gap-2 font-mono text-[15px] font-medium tracking-tight text-bone',
                className,
            )}
        >
            {showMark ? <BrandMark size={markSize} /> : null}
            <span>daemons.run</span>
        </span>
    );
}
