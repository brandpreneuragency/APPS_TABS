import { useState } from 'react';
import { nanoid } from 'nanoid';
import {
  ListOrdered,
  GitBranch,
  CheckSquare,
  EyeOff,
  Globe,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  MousePointerClick,
} from 'lucide-react';
import type {
  LeadForm,
  LeadFormStep,
  LeadFormLogicRule,
  LeadFormField,
  LeadFormValidation,
} from '../../../types/forms';
import { useFormsStore } from '../../../stores/formsStore';
import { LogicRuleEditor } from './components/LogicRuleEditor';
import { UtmCaptureConfig } from './components/UtmCaptureConfig';
import './logicTab.css';

interface LogicTabProps {
  form: LeadForm;
}

type SectionId = 'steps' | 'rules' | 'validation' | 'hidden' | 'utm';

const SECTIONS: { id: SectionId; label: string; icon: typeof ListOrdered }[] = [
  { id: 'steps', label: 'Steps', icon: ListOrdered },
  { id: 'rules', label: 'Conditional Rules', icon: GitBranch },
  { id: 'validation', label: 'Validation', icon: CheckSquare },
  { id: 'hidden', label: 'Hidden Fields', icon: EyeOff },
  { id: 'utm', label: 'UTM Capture', icon: Globe },
];

function newRule(): LeadFormLogicRule {
  return {
    id: nanoid(8),
    type: 'show_field',
    triggerFieldId: '',
    operator: 'eq',
    value: '',
    targetFieldIds: [],
    enabled: true,
  };
}

function newStep(order: number): LeadFormStep {
  return {
    id: nanoid(8),
    title: `Step ${order}`,
    order,
  };
}

export default function LogicTab({ form }: LogicTabProps) {
  const updateForm = useFormsStore((s) => s.updateForm);
  const updateField = useFormsStore((s) => s.updateField);
  const [activeSection, setActiveSection] = useState<SectionId>('steps');

  const scrollToSection = (id: SectionId) => {
    setActiveSection(id);
    const el = document.getElementById(`forms-logic-section-${id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ---- Steps ----
  const sortedSteps = [...form.steps].sort((a, b) => a.order - b.order);

  const commitSteps = (next: LeadFormStep[]) => {
    void updateForm(form.id, { steps: next });
  };

  const addStep = () => {
    const order = sortedSteps.length ? Math.max(...sortedSteps.map((s) => s.order)) + 1 : 1;
    commitSteps([...form.steps, newStep(order)]);
  };

  const renameStep = (id: string, title: string) => {
    commitSteps(form.steps.map((s) => (s.id === id ? { ...s, title } : s)));
  };

  const removeStep = (id: string) => {
    commitSteps(form.steps.filter((s) => s.id !== id));
  };

  const moveStep = (id: string, dir: -1 | 1) => {
    const ordered = [...sortedSteps];
    const idx = ordered.findIndex((s) => s.id === id);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= ordered.length) return;
    const a = ordered[idx];
    const b = ordered[swap];
    const swapped = ordered.map((s) => {
      if (s.id === a.id) return { ...s, order: b.order };
      if (s.id === b.id) return { ...s, order: a.order };
      return s;
    });
    commitSteps(swapped);
  };

  // ---- Rules ----
  const addRule = () => {
    void updateForm(form.id, { logicRules: [...form.logicRules, newRule()] });
  };

  const updateRule = (updated: LeadFormLogicRule) => {
    void updateForm(form.id, {
      logicRules: form.logicRules.map((r) => (r.id === updated.id ? updated : r)),
    });
  };

  const deleteRule = (id: string) => {
    void updateForm(form.id, { logicRules: form.logicRules.filter((r) => r.id !== id) });
  };

  // ---- Validation ----
  const sortedFields = [...form.fields].sort((a, b) => a.order - b.order);
  const hiddenFields = sortedFields.filter((f) => f.type === 'hidden');
  const validationFields = sortedFields.filter((f) => f.type !== 'hidden' && f.type !== 'submit');

  const setFieldValidation = (field: LeadFormField, updates: Partial<LeadFormValidation>) => {
    const nextValidation: LeadFormValidation = { ...field.validation, ...updates };
    void updateField(form.id, field.id, { validation: nextValidation });
  };

  const setFieldRequired = (field: LeadFormField, required: boolean) => {
    void updateField(form.id, field.id, { required });
  };

  return (
    <div className="ui-panel-body forms-builder-logic">
      <nav className="forms-builder-logic-nav" aria-label="Logic sections">
        {SECTIONS.map((section) => {
          const Icon = section.icon;
          const isActive = activeSection === section.id;
          return (
            <button data-active={isActive}
              key={section.id}
              type="button"
              className={"ui-button " + (`forms-builder-logic-nav-btn${isActive ? ' forms-builder-logic-nav-btn--active' : ''}`)}
              onClick={() => scrollToSection(section.id)}
            >
              <Icon />
              {section.label}
            </button>
          );
        })}
      </nav>

      {/* ---------- Steps ---------- */}
      <section
        id="forms-logic-section-steps"
        className="ui-card forms-builder-logic-section"
      >
        <div className="forms-builder-logic-section-head">
          <span className="forms-builder-logic-section-title">
            <ListOrdered className="forms-builder-logic-section-title-icon" />
            Steps
            <span className="forms-builder-logic-section-count">{form.steps.length}</span>
          </span>
          <button type="button" className="ui-button forms-builder-logic-add-btn" onClick={addStep}>
            <Plus /> Add step
          </button>
        </div>
        <p className="forms-builder-logic-section-hint">
          Multi-step forms group fields by step. Reorder to change the sequence shown to submitters.
        </p>
        {sortedSteps.length === 0 ? (
          <div className="forms-builder-logic-empty">
            <ListOrdered />
            <span className="forms-builder-logic-empty-title">No steps defined</span>
            <span className="forms-builder-logic-empty-sub">
              All fields render on a single page until you add steps.
            </span>
          </div>
        ) : (
          <div className="forms-builder-logic-steps">
            {sortedSteps.map((step, idx) => (
              <div key={step.id} className="forms-builder-step-row">
                <span className="forms-builder-step-order">{idx + 1}</span>
                <input
                  type="text"
                  className="ui-input forms-builder-logic-step-input"
                  value={step.title}
                  onChange={(e) => renameStep(step.id, e.target.value)}
                  placeholder="Step title"
                />
                <div style={{ display: 'flex', gap: 2 }}>
                  <button
                    type="button"
                    className="ui-icon-button forms-builder-logic-step-btn"
                    onClick={() => moveStep(step.id, -1)}
                    disabled={idx === 0}
                    aria-label="Move step up"
                    title="Move up"
                  >
                    <ChevronUp />
                  </button>
                  <button
                    type="button"
                    className="ui-icon-button forms-builder-logic-step-btn"
                    onClick={() => moveStep(step.id, 1)}
                    disabled={idx === sortedSteps.length - 1}
                    aria-label="Move step down"
                    title="Move down"
                  >
                    <ChevronDown />
                  </button>
                  <button
                    type="button"
                    className="ui-icon-button forms-builder-logic-step-btn ui-button--danger forms-builder-logic-step-btn--danger"
                    onClick={() => removeStep(step.id)}
                    aria-label="Delete step"
                    title="Delete step"
                  >
                    <Trash2 />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---------- Conditional rules ---------- */}
      <section
        id="forms-logic-section-rules"
        className="ui-card forms-builder-logic-section"
      >
        <div className="forms-builder-logic-section-head">
          <span className="forms-builder-logic-section-title">
            <GitBranch className="forms-builder-logic-section-title-icon" />
            Conditional Rules
            <span className="forms-builder-logic-section-count">{form.logicRules.length}</span>
          </span>
          <button type="button" className="ui-button forms-builder-logic-add-btn" onClick={addRule}>
            <Plus /> Add rule
          </button>
        </div>
        <p className="forms-builder-logic-section-hint">
          Examples: &ldquo;If budget &gt; 5000 → show project timeline&rdquo;,
          &ldquo;If service == Website → show current website URL&rdquo;,
          &ldquo;If country is empty → block submit&rdquo;.
        </p>
        {form.logicRules.length === 0 ? (
          <div className="forms-builder-logic-empty">
            <GitBranch />
            <span className="forms-builder-logic-empty-title">No rules yet</span>
            <span className="forms-builder-logic-empty-sub">
              Add a rule to conditionally show, hide, or block based on field values.
            </span>
          </div>
        ) : (
          <div className="forms-builder-logic-rules">
            {form.logicRules.map((rule) => (
              <LogicRuleEditor
                key={rule.id}
                form={form}
                rule={rule}
                onChange={updateRule}
                onDelete={() => deleteRule(rule.id)}
              />
            ))}
          </div>
        )}
      </section>

      {/* ---------- Validation ---------- */}
      <section
        id="forms-logic-section-validation"
        className="ui-card forms-builder-logic-section"
      >
        <div className="forms-builder-logic-section-head">
          <span className="forms-builder-logic-section-title">
            <CheckSquare className="forms-builder-logic-section-title-icon" />
            Validation
            <span className="forms-builder-logic-section-count">{validationFields.length}</span>
          </span>
        </div>
        <p className="forms-builder-logic-section-hint">
          Per-field required flag plus min/max/pattern constraints. Applied on submit.
        </p>
        {validationFields.length === 0 ? (
          <div className="forms-builder-logic-empty">
            <MousePointerClick />
            <span className="forms-builder-logic-empty-title">No editable fields</span>
            <span className="forms-builder-logic-empty-sub">
              Add fields on the Build tab to configure validation.
            </span>
          </div>
        ) : (
          <div className="forms-builder-logic-validation-list">
            {validationFields.map((field) => {
              const v = field.validation ?? {};
              return (
                <div key={field.id} className="ui-card forms-builder-logic-validation-row">
                  <div className="forms-builder-logic-validation-head">
                    <span className="forms-builder-logic-validation-name">
                      <span className="forms-builder-logic-validation-name-text">
                        {field.label || field.name}
                      </span>
                      <span className="forms-builder-logic-validation-type">{field.type}</span>
                    </span>
                    <label className="forms-builder-logic-checkbox-row">
                      <input
                        type="checkbox"
                        className="forms-builder-logic-utm-checkbox"
                        checked={!!field.required}
                        onChange={(e) => setFieldRequired(field, e.target.checked)}
                      />
                      Required
                    </label>
                  </div>
                  <div className="forms-builder-logic-validation-controls">
                    <div className="ui-field forms-builder-logic-validation-field">
                      <span className="forms-builder-logic-validation-field-label">Min (number)</span>
                      <input
                        type="number"
                        className="ui-input forms-builder-logic-input"
                        value={v.min ?? ''}
                        onChange={(e) =>
                          setFieldValidation(field, {
                            min: e.target.value === '' ? undefined : Number(e.target.value),
                          })
                        }
                        placeholder="—"
                      />
                    </div>
                    <div className="ui-field forms-builder-logic-validation-field">
                      <span className="forms-builder-logic-validation-field-label">Max (number)</span>
                      <input
                        type="number"
                        className="ui-input forms-builder-logic-input"
                        value={v.max ?? ''}
                        onChange={(e) =>
                          setFieldValidation(field, {
                            max: e.target.value === '' ? undefined : Number(e.target.value),
                          })
                        }
                        placeholder="—"
                      />
                    </div>
                    <div className="ui-field forms-builder-logic-validation-field">
                      <span className="forms-builder-logic-validation-field-label">Pattern (regex)</span>
                      <input
                        type="text"
                        className="ui-input forms-builder-logic-input"
                        value={v.pattern ?? ''}
                        onChange={(e) => setFieldValidation(field, { pattern: e.target.value })}
                        placeholder="e.g. ^[A-Z]{2}$"
                      />
                    </div>
                    <div className="ui-field forms-builder-logic-validation-field">
                      <span className="forms-builder-logic-validation-field-label">Error message</span>
                      <input
                        type="text"
                        className="ui-input forms-builder-logic-input"
                        value={v.message ?? ''}
                        onChange={(e) => setFieldValidation(field, { message: e.target.value })}
                        placeholder="Shown on validation failure"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ---------- Hidden fields ---------- */}
      <section
        id="forms-logic-section-hidden"
        className="ui-card forms-builder-logic-section"
      >
        <div className="forms-builder-logic-section-head">
          <span className="forms-builder-logic-section-title">
            <EyeOff className="forms-builder-logic-section-title-icon" />
            Hidden Fields
            <span className="forms-builder-logic-section-count">{hiddenFields.length}</span>
          </span>
        </div>
        <p className="forms-builder-logic-section-hint">
          Hidden fields are submitted silently (e.g. pre-filled campaign IDs). Read-only here —
          edit them on the Build tab.
        </p>
        {hiddenFields.length === 0 ? (
          <div className="forms-builder-logic-empty">
            <EyeOff />
            <span className="forms-builder-logic-empty-title">No hidden fields</span>
            <span className="forms-builder-logic-empty-sub">
              Add a Hidden field from the Build palette to capture static values.
            </span>
          </div>
        ) : (
          <div className="forms-builder-logic-hidden-chips">
            {hiddenFields.map((field) => (
              <span key={field.id} className="forms-builder-logic-hidden-chip">
                {field.label || field.name}
                <span className="forms-builder-logic-hidden-chip-name">{field.name}</span>
              </span>
            ))}
          </div>
        )}
      </section>

      {/* ---------- UTM capture ---------- */}
      <div id="forms-logic-section-utm">
        <UtmCaptureConfig form={form} />
      </div>
    </div>
  );
}
