'use client';

import { defaultKeymap } from '@codemirror/commands';
import {
  HighlightStyle, bracketMatching, foldGutter, foldKeymap, syntaxHighlighting, type LanguageSupport,
} from '@codemirror/language';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState } from '@codemirror/state';
import {
  EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { useEffect, useRef } from 'react';
import type { CodeLanguage } from '@/lib/code-language';

/** Grammars load on demand, so a preview only pulls in the one it needs. */
const LOADERS: Record<CodeLanguage, () => Promise<LanguageSupport>> = {
  javascript: () => import('@codemirror/lang-javascript').then((m) => m.javascript()),
  jsx: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ jsx: true })),
  typescript: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ typescript: true })),
  tsx: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ jsx: true, typescript: true })),
  json: () => import('@codemirror/lang-json').then((m) => m.json()),
  python: () => import('@codemirror/lang-python').then((m) => m.python()),
  html: () => import('@codemirror/lang-html').then((m) => m.html()),
  xml: () => import('@codemirror/lang-xml').then((m) => m.xml()),
  css: () => import('@codemirror/lang-css').then((m) => m.css()),
  sql: () => import('@codemirror/lang-sql').then((m) => m.sql()),
  markdown: () => import('@codemirror/lang-markdown').then((m) => m.markdown()),
  yaml: () => import('@codemirror/lang-yaml').then((m) => m.yaml()),
  php: () => import('@codemirror/lang-php').then((m) => m.php()),
  java: () => import('@codemirror/lang-java').then((m) => m.java()),
  go: () => import('@codemirror/lang-go').then((m) => m.go()),
  rust: () => import('@codemirror/lang-rust').then((m) => m.rust()),
  cpp: () => import('@codemirror/lang-cpp').then((m) => m.cpp()),
};

// Built from the Align tokens, which `.dark` redefines, so one theme serves both modes.
const theme = EditorView.theme({
  '&': { height: '100%', color: 'var(--color-text-strong-950)', backgroundColor: 'var(--color-bg-white-0)' },
  '.cm-scroller': { fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: '12px', lineHeight: '1.6' },
  '.cm-gutters': {
    backgroundColor: 'var(--color-bg-weak-50)', color: 'var(--color-text-soft-400)',
    borderRight: '1px solid var(--color-stroke-soft-200)',
  },
  '.cm-activeLine': { backgroundColor: 'var(--color-primary-alpha-10)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--color-primary-alpha-10)', color: 'var(--color-text-sub-600)' },
  '.cm-cursor': { borderLeftColor: 'var(--color-text-strong-950)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'var(--color-primary-alpha-24)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--color-primary-alpha-16)' },
  '.cm-searchMatch': { backgroundColor: 'var(--color-warning-lighter)', outline: '1px solid var(--color-warning-base)' },
  '.cm-matchingBracket': { backgroundColor: 'var(--color-primary-alpha-16)', outline: 'none' },
  '.cm-panels': { backgroundColor: 'var(--color-bg-weak-50)', color: 'var(--color-text-strong-950)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--color-stroke-soft-200)' },
});

const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.operatorKeyword, tags.modifier], color: 'var(--color-feature-base)' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: 'var(--color-success-base)' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: 'var(--color-warning-base)' },
  { tag: [tags.comment, tags.meta], color: 'var(--color-text-soft-400)', fontStyle: 'italic' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--color-information-base)' },
  { tag: [tags.typeName, tags.className, tags.tagName], color: 'var(--color-away-base)' },
  { tag: [tags.attributeName, tags.propertyName], color: 'var(--color-verified-base)' },
  { tag: tags.heading, color: 'var(--color-primary-base)', fontWeight: '600' },
  { tag: tags.link, color: 'var(--color-information-base)', textDecoration: 'underline' },
  { tag: tags.invalid, color: 'var(--color-error-base)' },
]);

/**
 * Read-only CodeMirror for a code attachment: line numbers, folding, search
 * (Ctrl/⌘+F) and selection, but no edits.
 */
export default function CodeView({ text, language }: { text: string; language: CodeLanguage | null }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!host.current) return;
    const grammar = new Compartment();
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: text,
        extensions: [
          EditorState.readOnly.of(true),
          lineNumbers(),
          foldGutter(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          drawSelection(),
          bracketMatching(),
          highlightSelectionMatches(),
          search({ top: true }),
          keymap.of([...searchKeymap, ...foldKeymap, ...defaultKeymap]),
          syntaxHighlighting(highlight),
          theme,
          grammar.of([]),
          EditorView.contentAttributes.of({ 'aria-label': 'File contents' }),
        ],
      }),
    });

    let live = true;
    if (language) {
      LOADERS[language]()
        .then((support) => {
          if (live) view.dispatch({ effects: grammar.reconfigure(support) });
        })
        // A grammar chunk that fails to load leaves the code readable, just plain.
        .catch(() => {});
    }
    return () => {
      live = false;
      view.destroy();
    };
  }, [text, language]);

  return <div ref={host} className="h-full" />;
}
