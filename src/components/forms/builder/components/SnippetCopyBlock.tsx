import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { useUIStore } from '../../../../stores/uiStore';

interface SnippetCopyBlockProps {
  snippet: string;
  language?: string;
}

const LANG_LABEL: Record<string, string> = {
  html: 'HTML',
  tsx: 'React',
  text: 'Text',
};

export function SnippetCopyBlock({ snippet, language = 'html' }: SnippetCopyBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      useUIStore.getState().showToast('Copied to clipboard', 'info');
      setTimeout(() => setCopied(false), 1500);
    } catch {
      useUIStore.getState().showToast('Copy failed — select and copy manually', 'error');
    }
  };

  return (
    <div className="forms-builder-embed-copy">
      <div className="forms-builder-embed-copy-head">
        <span className="forms-builder-embed-copy-lang">{LANG_LABEL[language] ?? language}</span>
        <button
          type="button"
          className={"ui-button " + (`forms-builder-embed-copy-btn${copied ? ' forms-builder-embed-copy-btn--done' : ''}`)}
          onClick={() => void handleCopy()}
          aria-label="Copy snippet"
        >
          {copied ? <Check /> : <Copy />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="forms-builder-embed-copy-pre">{snippet}</pre>
    </div>
  );
}

export default SnippetCopyBlock;
