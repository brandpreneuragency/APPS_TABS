import { useEffect, useMemo, useState } from 'react';
import { useFormsStore } from '../../../stores/formsStore';
import { useUIStore } from '../../../stores/uiStore';
import { buildSnippet } from '../../../services/embedService';
import type { EmbedSnippetMode } from '../../../services/embedService';
import { FormSummary } from '../detail/FormSummary';
import { FormsEmptyState } from '../components/FormsEmptyState';
import { FormsTabBar, type FormsTab } from '../components/FormsTabBar';
import { EmbedSnippetPreview } from '../components/EmbedSnippetPreview';
import {
  FileText,
  Code2,
  Copy,
  Save,
  FilePlus2,
  Pencil,
} from 'lucide-react';
import '../forms.css';

const EMBED_MODES: { key: EmbedSnippetMode; label: string }[] = [
  { key: 'iframe', label: 'iframe' },
  { key: 'html_script', label: 'HTML/script' },
  { key: 'react', label: 'React' },
  { key: 'web_component', label: 'Web Component' },
];

export default function FormsListPage() {
  const activeFormId = useFormsStore((s) => s.activeFormId);
  const isLoaded = useFormsStore((s) => s.isLoaded);
  const loadForms = useFormsStore((s) => s.loadForms);
  const form = useFormsStore((s) => s.getFormById(activeFormId));
  const submissions = useFormsStore((s) => s.submissions);
  const kpis = useMemo(() => {
    if (!activeFormId) return { total: 0, converted: 0, spam: 0, conversionRate: 0 };
    const subs = submissions.filter((s) => s.formId === activeFormId);
    const total = subs.length;
    const converted = subs.filter((s) => s.status === 'converted').length;
    const spam = subs.filter((s) => s.status === 'spam').length;
    const legitimate = total - spam;
    const conversionRate = legitimate > 0 ? converted / legitimate : 0;
    return { total, converted, spam, conversionRate };
  }, [submissions, activeFormId]);
  const duplicateForm = useFormsStore((s) => s.duplicateForm);
  const saveFormAsTemplate = useFormsStore((s) => s.saveFormAsTemplate);
  const setActiveFormId = useFormsStore((s) => s.setActiveFormId);
  const showToast = useUIStore((s) => s.showToast);
  const setActiveFormsPage = useUIStore((s) => s.setActiveFormsPage);

  const [showEmbed, setShowEmbed] = useState(false);
  const [embedMode, setEmbedMode] = useState<EmbedSnippetMode>('iframe');
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateDesc, setTemplateDesc] = useState('');

  useEffect(() => {
    if (!isLoaded) void loadForms();
  }, [isLoaded, loadForms]);

  // Reset embed mode to iframe when switching forms.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShowEmbed(false);
    setShowSaveTemplate(false);
    setEmbedMode('iframe');
  }, [activeFormId]);

  const embedTabs: FormsTab[] = useMemo(
    () => EMBED_MODES.map((m) => ({ key: m.key, label: m.label, icon: Code2 })),
    [],
  );

  const snippets = useMemo(() => {
    if (!form) return [];
    return EMBED_MODES.map((m) => buildSnippet(form.id, m.key, form));
  }, [form]);

  if (!form) {
    return (
      <div className="ui-panel-body forms-page forms-page--scroll">
        <FormsEmptyState
          icon={FileText}
          title="Select a form"
          subtitle="Pick a form from the list on the left to see its summary, embed code and quick actions."
        />
      </div>
    );
  }

  const handleEdit = () => {
    setActiveFormsPage('builder');
  };
  const handleGetEmbed = () => {
    setShowEmbed((v) => !v);
  };
  const handleDuplicate = async () => {
    const copy = await duplicateForm(form.id);
    if (copy) {
      setActiveFormId(copy.id);
      showToast(`Duplicated as “${copy.name}”.`, 'info');
    }
  };
  const openSaveTemplate = () => {
    setTemplateName(`${form.name} template`);
    setTemplateDesc(form.description ?? '');
    setShowSaveTemplate(true);
  };
  const handleSaveTemplate = async () => {
    const name = templateName.trim();
    if (!name) {
      showToast('Enter a template name.', 'error');
      return;
    }
    const tpl = await saveFormAsTemplate(form.id, name, templateDesc.trim() || undefined);
    if (tpl) {
      setShowSaveTemplate(false);
      showToast(`Saved template “${tpl.name}”.`, 'info');
    }
  };

  const activeSnippet = snippets.find((s) => s.mode === embedMode) ?? snippets[0];

  return (
    <div className="ui-panel-body forms-page forms-page--scroll">
      <FormSummary form={form} kpis={kpis} />

      <div className="forms-actions">
        <button type="button" className="ui-button forms-action-btn ui-button--primary forms-action-btn--primary" onClick={handleEdit}>
          <Pencil /> Edit
        </button>
        <button type="button" className="ui-button forms-action-btn" onClick={handleGetEmbed}>
          <Code2 /> Get embed code
        </button>
        <button type="button" className="ui-button forms-action-btn" onClick={handleDuplicate}>
          <Copy /> Duplicate
        </button>
        <button type="button" className="ui-button forms-action-btn" onClick={openSaveTemplate}>
          <Save /> Save as template
        </button>
      </div>

      {showEmbed ? (
        <div className="ui-card forms-section">
          <div className="forms-spread">
            <p className="forms-section-title">
              <Code2 /> Embed code
            </p>
            <span className="forms-section-hint">
              Public rendering requires a future VPS endpoint (see CRM_FORMS_PUBLIC_CAPTURE_TODO).
            </span>
          </div>
          <FormsTabBar tabs={embedTabs} active={embedMode} onChange={(k) => setEmbedMode(k as EmbedSnippetMode)} />
          {activeSnippet ? (
            <EmbedSnippetPreview
              snippet={activeSnippet.code}
              language={activeSnippet.language}
              label={EMBED_MODES.find((m) => m.key === activeSnippet.mode)?.label}
            />
          ) : null}
        </div>
      ) : null}

      {showSaveTemplate ? (
        <div className="ui-card forms-section">
          <p className="forms-section-title">
            <FilePlus2 /> Save form as template
          </p>
          <div className="forms-settings-row">
            <div className="ui-field forms-field-group">
              <label className="forms-field-group-label">Template name</label>
              <input
                className="ui-input forms-input"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="e.g. Demo Request template"
              />
            </div>
            <div className="ui-field forms-field-group">
              <label className="forms-field-group-label">Description (optional)</label>
              <input
                className="ui-input forms-input"
                value={templateDesc}
                onChange={(e) => setTemplateDesc(e.target.value)}
                placeholder="Short note about this template"
              />
            </div>
          </div>
          <div className="forms-actions">
            <button type="button" className="ui-button forms-action-btn ui-button--primary forms-action-btn--primary" onClick={handleSaveTemplate}>
              <Save /> Save template
            </button>
            <button type="button" className="ui-button forms-action-btn forms-action-btn--ghost" onClick={() => setShowSaveTemplate(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
