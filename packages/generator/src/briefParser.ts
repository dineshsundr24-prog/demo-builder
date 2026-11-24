// Deterministic extraction of an explicit, ordered screen list from a business
// brief (fixes RCA R9). The BA's numbering and titles are authoritative: AI may
// enrich each screen but never adds, drops, renames or reorders listed screens.
export type ListedScreen = { number: number; id: string; title: string; requirement: string };
export type ParsedBrief = { screens: ListedScreen[]; globalContext: string; notes: string[] };

const SEP = '\\s*[-–—:.)]\\s*';
const patterns: { re: RegExp; kind: string }[] = [
  { kind: 'heading', re: new RegExp('^\\s{0,3}#{1,6}\\s*(?:screen|page)\\s+(\\d{1,3})' + SEP + '(.+?)\\s*#*\\s*$', 'i') },
  { kind: 'bold-screen', re: new RegExp('^\\s*(?:[-*]\\s+)?\\*\\*\\s*(?:screen|page)\\s+(\\d{1,3})' + SEP + '(.+?)\\s*\\*\\*\\s*:?\\s*(.*)$', 'i') },
  { kind: 'plain-screen', re: new RegExp('^\\s*(?:[-*]\\s+)?(?:screen|page)\\s+(\\d{1,3})' + SEP + '(.+)$', 'i') },
  // "1. **Welcome:** details" / "1) **Welcome** - details"
  { kind: 'numbered-bold', re: /^\s*(\d{1,3})[.)]\s+\*\*\s*(.+?)\s*:?\s*\*\*\s*[:\-–—]?\s*(.*)$/ },
];
const slug = (t: string) => t.toLowerCase().normalize('NFKD').replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'screen';
const cleanTitle = (t: string) => t.replace(/\*+/g, '').replace(/[:\s]+$/, '').trim().slice(0, 85);

function match(line: string) {
  for (const p of patterns) {
    const m = p.re.exec(line);
    if (m) {
      // For "Title: details" on plain/heading lines, split title from inline details.
      let title = m[2], rest = m[3] ?? '';
      if (p.kind === 'plain-screen' || p.kind === 'heading') {
        const split = /:\s|\s[-–—]\s/.exec(title); // "Title: details" or "Title - details"
        if (split) { rest = title.slice(split.index + split[0].length).trim(); title = title.slice(0, split.index); }
      }
      return { number: Number(m[1]), title: cleanTitle(title), rest: rest.trim(), kind: p.kind };
    }
  }
  return null;
}

export function parseBrief(brief: string): ParsedBrief | null {
  const lines = String(brief ?? '').replace(/\r\n?/g, '\n').split('\n');
  const notes: string[] = [];
  type Block = { number: number; title: string; lines: string[]; start: number; end: number };
  const blocks: Block[] = [];
  let current: Block | null = null;
  let blankRun = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = match(line);
    if (m && m.title) {
      current = { number: m.number, title: m.title, lines: m.rest ? [m.rest] : [], start: i, end: i };
      blocks.push(current); blankRun = 0; continue;
    }
    if (!current) continue;
    if (!line.trim()) { blankRun++; continue; }
    // A blank line followed by unindented prose or a heading ends the screen's block;
    // that text is global context (e.g. "Journeys: ...", clarifications).
    const continuation = blankRun === 0 || /^\s{2,}|^\s*[-*•]\s/.test(line);
    if (!continuation) { current = null; blankRun = 0; continue; }
    current.lines.push(line.trim()); current.end = i; blankRun = 0;
  }
  // Keep the first consecutive run 1..N; ignore a repeated paste of the same list.
  const run: Block[] = [];
  for (const b of blocks) {
    if (b.number === run.length + 1) { run.push(b); continue; }
    if (b.number === 1 && run.length && run[0].title.toLowerCase() === b.title.toLowerCase()) { notes.push('Ignored a repeated copy of the screen list'); break; }
    if (b.number === 1 && run.length < 2) { run.length = 0; run.push(b); continue; }
    if (run.length >= 2) { notes.push('Ignored screen numbering after "' + run[run.length - 1].title + '" (expected ' + (run.length + 1) + ', found ' + b.number + ')'); break; }
  }
  if (run.length < 2) return null;
  const used = new Set<string>();
  const screens = run.map(b => {
    const base = slug(b.title); let id = base, n = 2;
    while (used.has(id)) id = base + '-' + n++;
    used.add(id);
    return { number: b.number, id, title: b.title, requirement: [b.title, ...b.lines].join('\n').slice(0, 4000) };
  });
  const inBlock = new Set<number>();
  for (const b of run) for (let i = b.start; i <= b.end; i++) inBlock.add(i);
  // Lines of ignored duplicate blocks are not global context either.
  for (const b of blocks.filter(x => !run.includes(x))) for (let i = b.start; i <= b.end; i++) inBlock.add(i);
  const globalContext = lines.filter((_, i) => !inBlock.has(i)).join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 8000);
  return { screens, globalContext, notes };
}

/** Brand colours stated in the brief, in order of appearance. */
export function briefColours(brief: string): string[] {
  return [...new Set([...String(brief).matchAll(/#[0-9a-fA-F]{6}\b/g)].map(m => m[0].toUpperCase()))].slice(0, 3);
}
