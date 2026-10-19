import { useEffect, useState } from 'react';
import { Code2, FileCode, Atom, Box } from 'lucide-react';
import type { EmbedSnippet, EmbedSnippetMode } from '../../../../services/embedService';
import {
  generateIframeSnippet,
  generateHtmlScriptSnippet,
  generateReactSnippet,
  generateWebComponentSnippet,
} from '../../../../services/embedService';
import { SnippetCopyBlock } from './SnippetCopyBlock';

interface EmbedSnippetTabsProps {
  formId: string;
}

interface TabDef {
  mode: EmbedSnippetMode;
  label: string;
  icon: typeof Code2;
  generate: (formId: string) => Promise<EmbedSnippet>;
}

const TABS: TabDef[] = [
  { mode: 'iframe', label: 'Iframe', icon: FileCode, generate: generateIframeSnippet },
  { mode: 'html_script', label: 'HTML/Script', icon: Code2, generate: generateHtmlScriptSnippet },
  { mode: 'react', label: 'React', icon: Atom, generate: generateReactSnippet },
  { mode: 'web_component', label: 'Web Component', icon: Box, generate: generateWebComponentSnippet },
];

export function EmbedSnippetTabs({ formId }: EmbedSnippetTabsProps) {
  const [active, setActive] = useState<EmbedSnippetMode>('iframe');
  const [snippet, setSnippet] = useState<EmbedSnippet | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    const tab = TABS.find((t) => t.mode === active) ?? TABS[0];
    void tab
      .generate(formId)
      .then((s) => {
        if (!cancelled) {
          setSnippet(s);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [formId, active]);

  return (
    <div className="forms-builder-embed-snippets">
      <div className="forms-builder-embed-snippet-tabs" role="tablist">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.mode === active;
          return (
            <button
              key={tab.mode}
              type="button"
              role="tab"
              aria-selected={isActive}
              data-active={isActive}
              className={"ui-button " + (`forms-builder-embed-snippet-tab${isActive ? ' forms-builder-embed-snippet-tab--active' : ''}`)}
              onClick={() => setActive(tab.mode)}
            >
              <Icon />
              {tab.label}
            </button>
          );
        })}
      </div>
      {loading ? (
        <div className="forms-builder-embed-copy">
          <div className="forms-builder-embed-copy-pre" style={{ color: 'var(--c-text-3)' }}>
            Generating snippet…
          </div>
        </div>
      ) : snippet ? (
        <SnippetCopyBlock snippet={snippet.code} language={snippet.language} />
      ) : (
        <div className="forms-builder-embed-copy">
          <div className="forms-builder-embed-copy-pre" style={{ color: 'var(--c-text-3)' }}>
            No snippet available.
          </div>
        </div>
      )}
    </div>
  );
}

export default EmbedSnippetTabs;
