import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import '../forms.css';

interface EmbedSnippetPreviewProps {
  snippet: string;
  language?: 'html' | 'tsx' | 'text';
  label?: string;
}

export function EmbedSnippetPreview({ snippet, language = 'html', label }: EmbedSnippetPreviewProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(snippet);
      } else {
        // Fallback for environments without the async clipboard API.
        const ta = document.createElement('textarea');
        ta.value = snippet;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Silently ignore clipboard failures — preview stays usable.
    }
  };

  return (
    <div className="forms-snippet-preview">
      <div className="forms-snippet-preview-head">
        <span className="forms-snippet-preview-label">{label ?? language.toUpperCase()}</span>
        <button
          type="button"
          onClick={handleCopy}
          className={"ui-button " + (`forms-snippet-copy${copied ? ' forms-snippet-copy--done' : ''}`)}
          title={copied ? 'Copied' : 'Copy to clipboard'}
        >
          {copied ? <Check /> : <Copy />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="forms-snippet-code">{snippet}</pre>
    </div>
  );
}
