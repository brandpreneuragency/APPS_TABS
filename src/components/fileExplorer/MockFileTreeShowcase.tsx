import { useState } from 'react';
import { ChevronRight, ChevronDown, Folder, FolderOpen, File } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type MockNode = {
  name: string;
  kind: 'file' | 'directory';
  children?: MockNode[];
};

const MOCK_TREE: MockNode[] = [
  {
    name: 'Documents',
    kind: 'directory',
    children: [
      { name: 'meeting-notes.md', kind: 'file' },
      { name: 'proposal.docx', kind: 'file' },
      {
        name: 'research',
        kind: 'directory',
        children: [
          { name: 'sources.md', kind: 'file' },
          { name: 'outline.md', kind: 'file' },
        ],
      },
    ],
  },
  {
    name: 'Projects',
    kind: 'directory',
    children: [
      { name: 'tabs-redesign.md', kind: 'file' },
      { name: 'archive', kind: 'directory', children: [] },
    ],
  },
  { name: 'todo.md', kind: 'file' },
];

/**
 * Static mockup of the file tree (no workspace store, no filesystem).
 * Shown when no folder is connected so the empty explorer still
 * communicates row height, nesting, selection, and expand states.
 */
export function MockFileTreeShowcase() {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<string[]>(['Documents', 'Documents/research']);
  const [selected, setSelected] = useState('Documents/meeting-notes.md');

  const toggle = (path: string) => {
    setExpanded((prev) => (prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]));
  };

  const renderNodes = (nodes: MockNode[], parentPath: string, depth: number) => (
    <ul style={{ display: 'flex', flexDirection: 'column', gap: 1, listStyle: 'none', padding: 0, margin: 0 }}>
      {nodes.map((node) => {
        const path = parentPath ? `${parentPath}/${node.name}` : node.name;
        const isDir = node.kind === 'directory';
        const isExpanded = expanded.includes(path);
        const isSelected = selected === path;
        return (
          <li
            key={path}
            data-testid={`mock-filetree-node-${path}`}
            tabIndex={0}
            onClick={() => {
              setSelected(path);
              if (isDir) toggle(path);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setSelected(path);
                if (isDir) toggle(path);
              }
            }}
            style={{
              borderRadius: 'var(--radius-sm)',
              backgroundColor: isSelected ? 'var(--c-background-3)' : 'transparent',
              fontSize: 'var(--fs-xs)',
              color: 'var(--c-text-1)',
              cursor: 'default',
            }}
          >
            <div className="row-xs" style={{ height: 32, paddingLeft: 6 + depth * 12, paddingRight: 6 }}>
              {isDir ? (
                <>
                  <span className="shrink-0 subtle" style={{ width: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                  </span>
                  {isExpanded
                    ? <FolderOpen size={13} className="shrink-0" style={{ color: isSelected ? 'var(--c-accent-1)' : 'var(--c-text-2)' }} />
                    : <Folder size={13} className="shrink-0" style={{ color: isSelected ? 'var(--c-accent-1)' : 'var(--c-text-2)' }} />}
                </>
              ) : (
                <>
                  <span className="shrink-0" style={{ width: 14 }} />
                  <File size={13} className="shrink-0" style={{ color: isSelected ? 'var(--c-accent-1)' : 'var(--c-text-2)' }} />
                </>
              )}
              <span
                className="trunc flex-1 min-w-0"
                style={{ marginLeft: 4, fontWeight: 500, color: isSelected ? 'var(--c-accent-1)' : 'var(--c-text-2)' }}
              >
                {node.name}
              </span>
            </div>
            {isDir && isExpanded && node.children && node.children.length > 0 && renderNodes(node.children, path, depth + 1)}
            {isDir && isExpanded && node.children?.length === 0 && (
              <div className="subtle" style={{ paddingLeft: 6 + (depth + 1) * 12, fontSize: 'var(--fs-xs)', height: 32, display: 'flex', alignItems: 'center' }}>
                {t('explorer.mockEmptyFolder')}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div id="mock-filetree-showcase" data-testid="mock-filetree-showcase" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <p className="subtle" data-testid="mock-filetree-hint" style={{ fontSize: 'var(--fs-xs)', textAlign: 'center', margin: 0 }}>
        {t('explorer.mockTreeHint')}
      </p>
      {renderNodes(MOCK_TREE, '', 0)}
    </div>
  );
}
