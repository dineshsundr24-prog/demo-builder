// Undo/redo for documents. Rapid edits to the same field (typing) merge into one step.
import { useCallback, useRef, useState } from 'react';
import type { DemoDocument } from '@demo/schema';

type H = { past: DemoDocument[]; present: DemoDocument | null; future: DemoDocument[] };
const LIMIT = 100, MERGE_MS = 800;

export function useHistory(initial: DemoDocument | null) {
  const [h, setH] = useState<H>({ past: [], present: initial, future: [] });
  const last = useRef<{ key: string; at: number } | null>(null);
  /** Record an edit. Edits with the same key within 0.8 s replace the previous step. */
  const commit = useCallback((doc: DemoDocument, key?: string) => {
    const now = Date.now(), merge = !!key && last.current?.key === key && now - last.current.at < MERGE_MS;
    last.current = key ? { key, at: now } : null;
    setH(s => (s.present === doc ? s : { past: merge || !s.present ? s.past : [...s.past, s.present].slice(-LIMIT), present: doc, future: [] }));
  }, []);
  /** Replace without history (load, import, generate). */
  const reset = useCallback((doc: DemoDocument | null) => { last.current = null; setH({ past: [], present: doc, future: [] }); }, []);
  const undo = useCallback(() => { last.current = null; setH(s => (s.past.length && s.present ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] } : s)); }, []);
  const redo = useCallback(() => { last.current = null; setH(s => (s.future.length && s.present ? { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) } : s)); }, []);
  return { doc: h.present, commit, reset, undo, redo, canUndo: h.past.length > 0, canRedo: h.future.length > 0 };
}

// Local draft and the presenter window share the document through localStorage.
export const DRAFT_KEY = 'demo-builder:draft', PRESENT_KEY = 'demo-builder:present';
export function saveLocal(key: string, doc: DemoDocument | null) { try { if (doc) localStorage.setItem(key, JSON.stringify(doc)); else localStorage.removeItem(key); } catch { /* storage full or blocked: drafts are a convenience */ } }
export function loadLocal(key: string): DemoDocument | null { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; } }
