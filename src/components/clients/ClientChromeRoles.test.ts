import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), 'src/components', path), 'utf8');

describe('Clients, CRM and Forms shared chrome', () => {
  it('assigns text, icon, input and navigation roles without local sizing', () => {
    expect(source('clients/ClientContacts.tsx')).toContain('ui-icon-button clients-icon-button');
    expect(source('clients/ClientNoteEditor.tsx')).toContain('ui-button clients-button');
    expect(source('clients/ClientNoteEditor.tsx')).toContain('className="ui-input"');
    expect(source('clients/ClientsCategoryPanel.tsx')).toContain('ui-list-row clients-category-tab');
    for (const path of ['clients/clients.css', 'crm/crm.css', 'forms/forms.css']) {
      expect(source(path)).not.toMatch(/\.(?:clients-button|clients-icon-button|crm-btn|forms-action-btn)\s*\{/);
    }
  });

  it('leaves one scroll owner below each workspace shell', () => {
    expect(source('layout/CRMWorkspace.tsx')).not.toContain('crm-workspace-body panel-body');
    expect(source('layout/FormsWorkspace.tsx')).not.toContain('forms-workspace-body panel-body');
    expect(source('layout/workspacePages.css')).not.toContain('overflow-y: auto');
    expect(source('crm/CRMListPanel.tsx')).toContain('ui-panel-body crm-list-content');
    expect(source('forms/FormsListPanel.tsx')).toContain('ui-panel-body forms-list-content');
  });

  it('connects selected tabs and rows to shared active states', () => {
    for (const path of ['crm/components/CRMTabBar.tsx', 'forms/components/FormsTabBar.tsx', 'crm/lists/LeadList.tsx', 'forms/lists/FormList.tsx']) {
      expect(source(path)).toContain('data-active={isActive}');
    }
  });

  it('keeps authored preview controls outside app input and button roles', () => {
    const builder = source('forms/builder/FormBuilder.tsx');
    expect(builder).toContain('className="forms-builder-form-input"');
    expect(builder).toContain('className="forms-builder-form-submit"');
    expect(builder).not.toMatch(/className="ui-(?:input|button) forms-builder-form-/);
    expect(source('forms/builder/builder.css')).toContain('font-size: var(--tabs-form-font-size)');
  });
});
