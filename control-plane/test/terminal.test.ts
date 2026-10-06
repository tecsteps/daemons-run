import { describe, expect, it } from 'vitest';
import { classifyTouchEnd, continuedUrlLines, findHttpUrls, linksInLines } from '../src/ui/lib/terminalLinks';
import { wheelReport } from '../src/ui/lib/terminalTouch';
import { terminalHarness } from '../src/worker/server-connection';

describe('terminal harness', () => {
  it('comes from the quick start command', () => {
    expect(terminalHarness('claude')).toBe('claude');
    expect(terminalHarness('codex --yolo')).toBe('codex');
    expect(terminalHarness(' /home/dev/.opencode/bin/opencode ')).toBe('opencode');
    expect(terminalHarness('htop')).toBe('shell');
    expect(terminalHarness(null)).toBe('shell');
  });
});

describe('wheel reports', () => {
  const cell = { column: 10, row: 5, x: 93, y: 41 };
  it('uses the encoding the application enabled', () => {
    expect(wheelReport(cell, true, 'sgr')).toBe('\x1b[<64;10;5M');
    expect(wheelReport(cell, false, 'sgr')).toBe('\x1b[<65;10;5M');
    expect(wheelReport(cell, true, 'sgr-pixels')).toBe('\x1b[<64;93;41M');
    expect(wheelReport(cell, true, 'default')).toEqual(new Uint8Array([0x1b, 0x5b, 0x4d, 96, 42, 37]));
    expect(wheelReport({ ...cell, column: 300 }, true, 'default')).toBeUndefined();
  });
});

describe('terminal links', () => {
  it('trims trailing punctuation and ignores other schemes', () => {
    expect(findHttpUrls('see https://example.com/a). and ftp://x').map((m) => m.url)).toEqual(['https://example.com/a']);
  });

  it('joins a URL a TUI hard-wrapped onto the next rows', () => {
    const rows = ['  https://claude.ai/oauth/authorize?code=true&client_id=', '  abc123&state=xyz', '  Paste code here if prompted >'];
    const row = (i: number) => (rows[i] === undefined ? undefined : { text: rows[i], wrapped: false });
    const links = linksInLines(continuedUrlLines(row, 0, rows[0], rows[0].length));
    expect(links[0].url).toBe('https://claude.ai/oauth/authorize?code=true&client_id=abc123&state=xyz');
    expect(links[0].range.end).toEqual({ x: 18, y: 2 });
  });

  it('classifies a short touch as a tap or a link, a drag as nothing', () => {
    const base = { cancelled: false, durationMs: 120, hasLink: false, longPressed: false, maximumDistancePx: 3, multiTouch: false, scrolling: false };
    expect(classifyTouchEnd(base)).toBe('tap');
    expect(classifyTouchEnd({ ...base, hasLink: true })).toBe('link');
    expect(classifyTouchEnd({ ...base, scrolling: true, maximumDistancePx: 80 })).toBe('none');
    expect(classifyTouchEnd({ ...base, durationMs: 900 })).toBe('none');
  });
});
