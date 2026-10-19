import { useState, type ReactNode } from 'react';
import { Copy } from 'lucide-react';
import { useGrace } from '../context';
import { Button, Modal } from './ui';
export function CopyButton({
  text,
  label = 'Copy',
  children,
}: {
  text: string | (() => string);
  label?: string;
  children?: ReactNode;
}) {
  const { toast } = useGrace();
  const [manual, setManual] = useState<string | null>(null);
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={async () => {
          const value = typeof text === 'function' ? text() : text;
          try {
            if (!navigator.clipboard) throw new Error('Unavailable');
            await navigator.clipboard.writeText(value);
            toast('Copied to clipboard.');
          } catch {
            setManual(value);
          }
        }}
      >
        <Copy size={15} />
        {children || label}
      </Button>
      {manual !== null && (
        <Modal title={label} onClose={() => setManual(null)}>
          <div className="modal-body">
            <p>Your browser could not copy automatically. Select and copy the text below.</p>
            <textarea
              className="copy-fallback"
              aria-label="Text to copy"
              value={manual}
              readOnly
              rows={manual.includes('\n') ? 10 : 3}
              onFocus={(e) => e.target.select()}
            />
          </div>
          <div className="modal-footer">
            <Button onClick={() => setManual(null)}>Done</Button>
          </div>
        </Modal>
      )}
    </>
  );
}
