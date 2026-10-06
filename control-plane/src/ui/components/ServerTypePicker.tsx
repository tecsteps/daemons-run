// Adapted from old daemons-run (tag pre-pivot-2026-09-05) resources/js/components/ServerLaneCards.tsx:
// one card per Hetzner group, each with the full type list sorted by price.
import { ChevronDown } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { archLabel, disabledReason, eur, groups, perMonth, priceAt, sizesIn, trafficTb, type GroupId, type Size } from '@/lib/catalog';
import { cn } from '@/lib/utils';

function useCompact() {
  const query = '(max-width: 47.999rem)';
  const [compact, setCompact] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setCompact(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return compact;
}

type Lane = { id: GroupId; label: string; hint: string; sizes: Size[]; current?: Size };

export function ServerTypePicker({
  sizes,
  location,
  selected,
  onSelect,
}: {
  sizes: Size[];
  location: string;
  selected: string;
  onSelect: (name: string) => void;
}) {
  const compact = useCompact();
  const [showUnavailable, setShowUnavailable] = useState(false);
  const [laneChoice, setLaneChoice] = useState<Partial<Record<GroupId, string>>>({});

  const lanes: Lane[] = useMemo(
    () =>
      groups.map((g) => {
        const list = sizesIn(sizes, g.id, location);
        const chosen = list.find((s) => s.name === laneChoice[g.id] && !disabledReason(s, location));
        return { ...g, sizes: list, current: chosen ?? list.find((s) => !disabledReason(s, location)) };
      }),
    [sizes, location, laneChoice],
  );

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label="Server type">
      <div className="flex items-center justify-between gap-3">
        <span className="text-control font-medium text-ink-900">Server type</span>
        <label className="flex items-center gap-2 text-caption text-muted">
          <span>Show unavailable types</span>
          <Switch data-testid="server-unavailable-toggle" checked={showUnavailable} onCheckedChange={setShowUnavailable} />
        </label>
      </div>
      <div role="radiogroup" className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-3">
        {lanes.map((lane) => {
          const isSelected = !!lane.current && selected === lane.current.name;
          const unavailable = !lane.current;
          return (
            <article
              key={lane.id}
              data-testid={`server-type-group-${lane.id}`}
              role="radio"
              aria-checked={isSelected}
              aria-disabled={unavailable || undefined}
              tabIndex={unavailable ? -1 : 0}
              onClick={() => lane.current && onSelect(lane.current.name)}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && lane.current) {
                  e.preventDefault();
                  onSelect(lane.current.name);
                }
              }}
              className={cn(
                'flex min-w-0 flex-col gap-2 rounded-md border bg-canvas p-3 text-left shadow-[0_1px_0_0_rgba(5,7,8,0.06)] transition-colors',
                isSelected ? 'border-lime ring-1 ring-lime' : 'border-line',
                unavailable ? 'cursor-not-allowed bg-surface text-muted' : 'cursor-pointer hover:border-ink-900',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-control font-semibold text-ink-900">{lane.label}</h2>
                  <p className="text-caption text-muted">{lane.hint}</p>
                </div>
                {lane.current ? (
                  <LaneChange
                    compact={compact}
                    lane={lane}
                    location={location}
                    showUnavailable={showUnavailable}
                    selected={selected}
                    onSelect={(name) => {
                      setLaneChoice((c) => ({ ...c, [lane.id]: name }));
                      onSelect(name);
                    }}
                  />
                ) : null}
              </div>
              {lane.current ? (
                <Summary size={lane.current} location={location} />
              ) : (
                <p className="text-body">Not available in {location}. Try another location.</p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function LaneChange({
  compact,
  lane,
  location,
  showUnavailable,
  selected,
  onSelect,
}: {
  compact: boolean;
  lane: Lane;
  location: string;
  showUnavailable: boolean;
  selected: string;
  onSelect: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rows = lane.sizes.filter((s) => showUnavailable || !disabledReason(s, location));
  const list = (
    <div className="min-w-0 divide-y divide-line" role="radiogroup" aria-label={lane.label}>
      <div className="hidden min-w-0 grid-cols-[minmax(4.5rem,1fr)_minmax(0,1.1fr)_repeat(4,minmax(0,0.8fr))_minmax(5.5rem,1fr)] gap-x-3 bg-surface px-3 py-2 text-caption text-muted md:grid">
        <span>Name</span>
        <span>CPU</span>
        <span>vCPUs</span>
        <span>RAM</span>
        <span>SSD</span>
        <span>Traffic</span>
        <span className="text-right">Price</span>
      </div>
      {rows.map((size) => {
        const reason = disabledReason(size, location);
        const price = priceAt(size, location);
        return (
          <div
            key={size.name}
            data-testid={`server-type-option-${size.name}`}
            role="radio"
            aria-checked={selected === size.name}
            aria-disabled={reason ? true : undefined}
            title={reason ?? undefined}
            tabIndex={0}
            onClick={() => {
              if (!reason) {
                onSelect(size.name);
                setOpen(false);
              }
            }}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && !reason) {
                e.preventDefault();
                onSelect(size.name);
                setOpen(false);
              }
            }}
            className={cn(
              'grid min-w-0 cursor-pointer grid-cols-2 gap-x-3 gap-y-1 p-3 text-left text-caption md:grid-cols-[minmax(4.5rem,1fr)_minmax(0,1.1fr)_repeat(4,minmax(0,0.8fr))_minmax(5.5rem,1fr)] md:items-center',
              selected === size.name && !reason ? 'bg-lime/15' : 'hover:bg-surface',
              reason && 'cursor-not-allowed opacity-50',
            )}
          >
            <div className="min-w-0">
              <p className="font-mono text-tech text-ink-900 uppercase">{size.name}</p>
              {reason ? <p className="text-muted">{reason}</p> : null}
            </div>
            <Spec label="CPU" value={`${size.cpuVendor} · ${archLabel(size.architecture)}`} />
            <Spec label="vCPUs" value={`${size.cpus}${size.cpuKind === 'dedicated' ? ' ded.' : ''}`} />
            <Spec label="RAM" value={`${size.memoryGb} GB`} />
            <Spec label="SSD" value={`${size.diskGb} GB`} />
            <Spec label="Traffic" value={trafficTb(size, location)} />
            <div className="text-right">
              <p className="font-mono text-ink-900">{eur(price?.monthly)}/mo</p>
              <p className="text-muted">{eur(price?.hourly, 4)}/h</p>
            </div>
          </div>
        );
      })}
    </div>
  );
  const trigger = (
    <Button data-testid={`server-lane-change-${lane.id}`} variant="secondary" size="sm" onClick={(e) => e.stopPropagation()}>
      Change <ChevronDown aria-hidden />
    </Button>
  );
  if (compact) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <Button
          data-testid={`server-lane-change-${lane.id}`}
          variant="secondary"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
        >
          Change <ChevronDown aria-hidden />
        </Button>
        <DialogContent className="top-auto bottom-0 max-h-[85dvh] max-w-none translate-y-0 overflow-y-auto rounded-b-none" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>{lane.label}</DialogTitle>
          </DialogHeader>
          {list}
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" collisionPadding={8} side="bottom" sideOffset={8} className="w-[min(46rem,calc(100vw-2rem))] p-0" onClick={(e) => e.stopPropagation()}>
        {list}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Summary({ size, location }: { size: Size; location: string }) {
  const price = priceAt(size, location);
  return (
    <dl className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-0 text-caption text-ink-900">
      <div className="col-span-2 min-w-0">
        <dt className="sr-only">Name</dt>
        <dd className="font-mono text-tech uppercase">{size.name}</dd>
      </div>
      <Spec label="CPU" value={`${size.cpuVendor} · ${archLabel(size.architecture)}`} />
      <Spec label="vCPUs" value={`${size.cpus} vCPU`} />
      <Spec label="RAM" value={`${size.memoryGb} GB RAM`} />
      <Spec label="SSD" value={`${size.diskGb} GB SSD`} />
      <Spec label="Traffic" value={`${trafficTb(size, location)} traffic`} />
      <div className="text-right">
        <dt className="sr-only">Price</dt>
        <dd className="font-mono">{perMonth(price?.monthly)}</dd>
        <p className="text-muted">{eur(price?.hourly, 4)}/h</p>
      </div>
    </dl>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted md:sr-only">{label}</dt>
      <dd className="truncate">{value}</dd>
    </div>
  );
}
