import { lazy, Suspense } from 'react';
import type { RichEditorProps } from './RichEditor';
const RichEditor = lazy(() =>
  import('./RichEditor').then((module) => ({ default: module.RichEditor })),
);
export function Editor(props: RichEditorProps) {
  return (
    <Suspense fallback={<div className="editor-loading skeleton" />}>
      <RichEditor {...props} />
    </Suspense>
  );
}
