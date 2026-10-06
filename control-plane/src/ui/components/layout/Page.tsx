// Adapted from old daemons-run resources/js/components/layout/{Page,PageHeader}.tsx
import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router';
import { cn } from '@/lib/utils';

export type Crumb = { label: string; to?: string };

export function Page({
  title,
  description,
  actions,
  status,
  crumbs,
  width = 'frame',
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  status?: ReactNode;
  crumbs?: Crumb[];
  width?: 'form' | 'frame' | 'console';
  children?: ReactNode;
}) {
  useEffect(() => {
    document.title = `${title} · daemons.run`;
  }, [title]);
  return (
    <div data-page-frame className={cn('mx-auto flex w-full min-w-0 flex-col pb-8', width === 'console' ? 'max-w-console' : 'max-w-frame')}>
      <div className={cn('flex w-full min-w-0 flex-col gap-page', width === 'form' && 'max-w-form')}>
        <header data-page-header className="flex min-w-0 flex-col gap-1">
          <nav aria-label="Breadcrumb" className="flex min-h-[var(--text-body--line-height)] min-w-0 items-center gap-1.5 overflow-hidden text-body whitespace-nowrap text-muted">
            {crumbs?.map((c, i) => (
              <span key={c.label} className="flex min-w-0 items-center gap-1.5">
                {i > 0 ? <span aria-hidden>/</span> : null}
                {c.to ? (
                  <Link to={c.to} className="truncate hover:text-ink-900 phone:inline-flex phone:min-h-11 phone:items-center">
                    {c.label}
                  </Link>
                ) : (
                  <span className="truncate text-ink-900">{c.label}</span>
                )}
              </span>
            ))}
          </nav>
          <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                <h1 tabIndex={-1} className="min-w-0 font-sans text-page-phone font-bold break-words text-ink-900 sm:text-page">
                  {title}
                </h1>
                {status}
              </div>
              {description ? <p className="text-body text-muted">{description}</p> : null}
            </div>
            {actions ? <div className="flex min-w-0 flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">{actions}</div> : null}
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}

/** The one card: every box on a signed-in page is a SectionCard. */
export function SectionCard({
  title,
  description,
  actions,
  footer,
  tone = 'default',
  children,
  className,
  testId,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  tone?: 'default' | 'lime' | 'danger';
  children?: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <section
      data-testid={testId}
      className={cn(
        'flex min-w-0 flex-col gap-4 rounded-md border border-line bg-surface p-card',
        tone === 'lime' && 'border-lime-deep bg-lime-pale',
        tone === 'danger' && 'border-red',
        className,
      )}
    >
      {title || description || actions ? (
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            {title ? <h2 className="font-sans text-card-title font-semibold text-ink-900">{title}</h2> : null}
            {description ? <p className="text-body text-muted">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
      {footer ? <div className="flex flex-wrap items-center gap-2">{footer}</div> : null}
    </section>
  );
}

/** A small uppercase label used inside cards, like the old "ACTIVE TERMINALS". */
export function Eyebrow({ children }: { children: ReactNode }) {
  return <h3 className="font-sans text-caption font-medium tracking-wide text-muted uppercase">{children}</h3>;
}
