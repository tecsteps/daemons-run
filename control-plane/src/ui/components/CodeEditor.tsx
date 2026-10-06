// CodeMirror setup adapted from old daemons-run resources/js/components/daemon/files/FilesCodeEditor.tsx
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { php } from '@codemirror/lang-php';
import { python } from '@codemirror/lang-python';
import { yaml } from '@codemirror/lang-yaml';
import { EditorState, type Extension } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { useEffect, useRef } from 'react';

function language(path: string): Extension[] {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (['js', 'mjs', 'cjs', 'jsx'].includes(ext)) return [javascript({ jsx: true })];
  if (['ts', 'tsx', 'mts'].includes(ext)) return [javascript({ jsx: true, typescript: true })];
  if (ext === 'json') return [json()];
  if (['css', 'scss'].includes(ext)) return [css()];
  if (['html', 'htm', 'vue', 'svelte'].includes(ext)) return [html()];
  if (['md', 'markdown'].includes(ext)) return [markdown()];
  if (ext === 'py') return [python()];
  if (['yml', 'yaml'].includes(ext)) return [yaml()];
  if (ext === 'php') return [php()];
  return [];
}

const fill = EditorView.theme({
  '&': { height: '100%', width: '100%', fontSize: '13px' },
  '.cm-scroller': { fontFamily: '"Geist Mono", ui-monospace, monospace', minHeight: '100%' },
  '.cm-gutters': { position: 'sticky', left: '0', zIndex: '1' },
});

/** A plain CodeMirror 6 editor: initial text, change callback, Cmd/Ctrl+S to save. */
export function CodeEditor({ path, initial, dark, onChange, onSave }: { path: string; initial: string; dark: boolean; onChange: (text: string) => void; onSave: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const handlers = useRef({ onChange, onSave });
  handlers.current = { onChange, onSave };

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: initial,
        extensions: [
          basicSetup,
          fill,
          ...(dark ? [oneDark] : []),
          ...language(path),
          EditorView.lineWrapping,
          keymap.of([
            {
              key: 'Mod-s',
              preventDefault: true,
              run: () => {
                handlers.current.onSave();
                return true;
              },
            },
          ]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) handlers.current.onChange(u.state.doc.toString());
          }),
          EditorView.contentAttributes.of({ autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' }),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
  }, [path, initial, dark]);

  return <div ref={host} data-testid="files-editor" className="h-full min-h-0 w-full overflow-hidden" />;
}
