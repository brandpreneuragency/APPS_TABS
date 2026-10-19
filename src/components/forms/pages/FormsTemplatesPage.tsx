import { useEffect, useMemo, useState } from 'react';
import { useFormsStore } from '../../../stores/formsStore';
import { useUIStore } from '../../../stores/uiStore';
import type { FormTemplate, LeadFormField } from '../../../types/forms';
import { TemplateCard } from '../detail/TemplateCard';
import { FormsEmptyState } from '../components/FormsEmptyState';
import {
  LayoutPanelTop,
  Save,
  X,
  Eye,
  Trash2,
  FileText,
  AlertTriangle,
} from 'lucide-react';
import '../forms.css';

function dateLabel(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('tr-TR', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

const FIELD_TYPE_LABEL: Record<LeadFormField['type'], string> = {
  text: 'Text',
  textarea: 'Long text',
  email: 'Email',
  phone: 'Phone',
  number: 'Number',
  select: 'Dropdown',
  radio: 'Radio',
  checkbox: 'Checkbox',
  date: 'Date',
  file: 'File upload',
  hidden: 'Hidden',
  consent: 'Consent',
  submit: 'Submit',
};

export default function FormsTemplatesPage() {
  const templates = useFormsStore((s) => s.templates);
  const forms = useFormsStore((s) => s.forms);
  const isLoaded = useFormsStore((s) => s.isLoaded);
  const loadForms = useFormsStore((s) => s.loadForms);
  const createFormFromTemplate = useFormsStore((s) => s.createFormFromTemplate);
  const saveFormAsTemplate = useFormsStore((s) => s.saveFormAsTemplate);
  const deleteTemplate = useFormsStore((s) => s.deleteTemplate);
  const deleteForm = useFormsStore((s) => s.deleteForm);
  const setActiveFormsPage = useUIStore((s) => s.setActiveFormsPage);
  const showToast = useUIStore((s) => s.showToast);

  const [previewTarget, setPreviewTarget] = useState<FormTemplate | null>(null);
  const [renameTarget, setRenameTarget] = useState<FormTemplate | null>(null);
  const [renameName, setRenameName] = useState('');
  const [renameDesc, setRenameDesc] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<FormTemplate | null>(null);
  const [saveFromFormId, setSaveFromFormId] = useState<string>(forms[0]?.id ?? '');
  const [saveFromName, setSaveFromName] = useState('');

  useEffect(() => {
    if (!isLoaded) void loadForms();
  }, [isLoaded, loadForms]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!saveFromFormId && forms[0]) setSaveFromFormId(forms[0].id);
  }, [forms, saveFromFormId]);

  const sorted = useMemo(
    () => [...templates].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [templates],
  );

  // --- Actions -----------------------------------------------------------

  const handleCreate = async (template: FormTemplate) => {
    const form = await createFormFromTemplate(template.id, template.name);
    if (form) {
      setActiveFormsPage('builder');
      showToast(`Created form “${form.name}” from template.`, 'info');
    }
  };

  // CRM_FORMS_TEMPLATE_RENAME_DUPLICATE_TODO:
  // formsService/formsStore expose no updateTemplate or duplicateTemplate
  // primitive (adding it is outside this agent's file ownership). Rename and
  // duplicate are therefore implemented with the available public actions:
  // create a transient form from the template, save it back as a template
  // (with the new name / copy suffix), then delete the transient form (and,
  // for rename, the old template). The activeFormId is restored afterwards.

  const withTransientForm = async (
    template: FormTemplate,
    name: string,
    description: string | undefined,
    onSaved: () => void,
  ) => {
    const prevActiveFormId = useFormsStore.getState().activeFormId;
    const transient = await createFormFromTemplate(template.id, name);
    if (!transient) return;
    const saved = await saveFormAsTemplate(transient.id, name, description);
    if (saved) onSaved();
    await deleteForm(transient.id);
    useFormsStore.getState().setActiveFormId(prevActiveFormId);
  };

  const handleDuplicate = async (template: FormTemplate) => {
    await withTransientForm(
      template,
      `${template.name} (copy)`,
      template.description,
      () => showToast(`Duplicated template as “${template.name} (copy)”.`, 'info'),
    );
  };

  const startRename = (template: FormTemplate) => {
    setRenameTarget(template);
    setRenameName(template.name);
    setRenameDesc(template.description ?? '');
  };

  const confirmRename = async () => {
    if (!renameTarget) return;
    const name = renameName.trim();
    if (!name) {
      showToast('Enter a template name.', 'error');
      return;
    }
    const target = renameTarget;
    setRenameTarget(null);
    await withTransientForm(target, name, renameDesc.trim() || undefined, async () => {
      await deleteTemplate(target.id);
      showToast(`Renamed template to “${name}”.`, 'info');
    });
  };

  const handleDelete = async (template: FormTemplate) => {
    await deleteTemplate(template.id);
    setConfirmDelete(null);
    showToast(`Deleted template “${template.name}”.`, 'info');
  };

  const handleSaveFormAsTemplate = async () => {
    if (!saveFromFormId) {
      showToast('Pick a form first.', 'error');
      return;
    }
    const name = saveFromName.trim();
    if (!name) {
      showToast('Enter a template name.', 'error');
      return;
    }
    const tpl = await saveFormAsTemplate(saveFromFormId, name);
    if (tpl) {
      setSaveFromName('');
      showToast(`Saved template “${tpl.name}”.`, 'info');
    }
  };

  // --- Render ------------------------------------------------------------

  return (
    <div className="ui-panel-body forms-page forms-page--scroll">
      <div className="forms-page-head">
        <h2 className="forms-page-title">Templates</h2>
        <p className="forms-page-subtitle">User-saved templates only — no built-in library in MVP.</p>
      </div>

      {/* Save existing form as template */}
      <div className="ui-card forms-section">
        <p className="forms-section-title">
          <Save /> Save existing form as template
        </p>
        <p className="forms-section-hint">
          Pick a form and name the template. The form’s fields, steps, logic, style and embed config are
          snapshotted into the template.
        </p>
        <div className="forms-settings-row">
          <div className="ui-field forms-field-group">
            <label className="forms-field-group-label">Source form</label>
            <select
              className="ui-input forms-select"
              value={saveFromFormId}
              onChange={(e) => setSaveFromFormId(e.target.value)}
              disabled={forms.length === 0}
            >
              {forms.length === 0 ? (
                <option value="">No forms available</option>
              ) : (
                forms.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))
              )}
            </select>
          </div>
          <div className="ui-field forms-field-group">
            <label className="forms-field-group-label">Template name</label>
            <div className="forms-row">
              <input
                className="ui-input forms-input"
                value={saveFromName}
                onChange={(e) => setSaveFromName(e.target.value)}
                placeholder="e.g. Newsletter signup template"
              />
              <button
                type="button"
                className="ui-button forms-action-btn ui-button--primary forms-action-btn--primary"
                onClick={handleSaveFormAsTemplate}
                disabled={!saveFromFormId}
              >
                <Save /> Save
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Templates grid */}
      {sorted.length === 0 ? (
        <FormsEmptyState
          icon={LayoutPanelTop}
          title="No saved templates"
          subtitle="Save a form as a template above, or use the “Save as template” action on a form. Templates you save will appear here."
        />
      ) : (
        <div className="forms-template-grid">
          {sorted.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              onCreate={handleCreate}
              onRename={startRename}
              onDuplicate={handleDuplicate}
              onDelete={(tpl) => setConfirmDelete(tpl)}
              onPreview={(tpl) => setPreviewTarget(tpl)}
            />
          ))}
        </div>
      )}

      {/* Preview modal */}
      {previewTarget ? (
        <div className="forms-preview-modal" onClick={() => setPreviewTarget(null)}>
          <div className="forms-preview-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="forms-preview-modal-head">
              <div className="forms-row">
                <Eye />
                <span className="forms-page-title">{previewTarget.name}</span>
              </div>
              <button
                type="button"
                className="ui-icon-button forms-action-btn forms-action-btn--ghost"
                onClick={() => setPreviewTarget(null)}
              >
                <X />
              </button>
            </div>
            <div className="ui-panel-body forms-preview-modal-body">
              {previewTarget.description ? (
                <p className="forms-section-hint" style={{ marginBottom: 10 }}>
                  {previewTarget.description}
                </p>
              ) : null}
              <p className="forms-section-hint" style={{ marginBottom: 8 }}>
                {previewTarget.schema.fields.filter((f) => f.type !== 'submit').length} fields ·
                saved {dateLabel(previewTarget.createdAt)}
              </p>
              <div className="ui-card forms-section" style={{ border: 'none' }}>
                {previewTarget.schema.fields.map((f) => (
                  <div className="forms-field-row" key={f.id}>
                    <span className="forms-field-label">
                      {f.label}
                      {f.required ? ' *' : ''}
                    </span>
                    <span className="forms-field-value">
                      <span className="forms-row" style={{ gap: 8 }}>
                        <FileText className="forms-muted" />
                        <span>{FIELD_TYPE_LABEL[f.type] ?? f.type}</span>
                        {f.disabledInPublishedEmbed ? (
                          <span className="forms-muted">(disabled in published embed)</span>
                        ) : null}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Rename modal */}
      {renameTarget ? (
        <div className="forms-preview-modal" onClick={() => setRenameTarget(null)}>
          <div className="forms-preview-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="forms-preview-modal-head">
              <span className="forms-page-title">Rename template</span>
              <button
                type="button"
                className="ui-icon-button forms-action-btn forms-action-btn--ghost"
                onClick={() => setRenameTarget(null)}
              >
                <X />
              </button>
            </div>
            <div className="ui-panel-body forms-preview-modal-body forms-stack">
              <div className="ui-field forms-field-group">
                <label className="forms-field-group-label">Name</label>
                <input
                  className="ui-input forms-input"
                  value={renameName}
                  onChange={(e) => setRenameName(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="ui-field forms-field-group">
                <label className="forms-field-group-label">Description (optional)</label>
                <input
                  className="ui-input forms-input"
                  value={renameDesc}
                  onChange={(e) => setRenameDesc(e.target.value)}
                />
              </div>
              <div className="forms-actions">
                <button
                  type="button"
                  className="ui-button forms-action-btn ui-button--primary forms-action-btn--primary"
                  onClick={confirmRename}
                >
                  <Save /> Save
                </button>
                <button
                  type="button"
                  className="ui-button forms-action-btn forms-action-btn--ghost"
                  onClick={() => setRenameTarget(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Delete confirm modal */}
      {confirmDelete ? (
        <div className="forms-preview-modal" onClick={() => setConfirmDelete(null)}>
          <div className="forms-preview-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="forms-preview-modal-head">
              <div className="forms-row">
                <AlertTriangle style={{ color: 'var(--c-danger)' }} />
                <span className="forms-page-title">Delete template</span>
              </div>
              <button
                type="button"
                className="ui-icon-button forms-action-btn forms-action-btn--ghost"
                onClick={() => setConfirmDelete(null)}
              >
                <X />
              </button>
            </div>
            <div className="ui-panel-body forms-preview-modal-body forms-stack">
              <p className="forms-section-hint">
                Delete “{confirmDelete.name}”? This cannot be undone. Forms already created from this
                template are not affected.
              </p>
              <div className="forms-actions">
                <button
                  type="button"
                  className="ui-button forms-action-btn ui-button--danger forms-action-btn--danger"
                  onClick={() => void handleDelete(confirmDelete)}
                >
                  <Trash2 /> Delete
                </button>
                <button
                  type="button"
                  className="ui-button forms-action-btn forms-action-btn--ghost"
                  onClick={() => setConfirmDelete(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
