// Inline field property editor — rendered inside each canvas field card.

import type { MouseEvent, KeyboardEvent } from 'react';
import type {
  LeadForm,
  LeadFormField,
  LeadFormOption,
  LeadFormValidation,
} from '../../../../types/forms';
import { useFormsStore } from '../../../../stores/formsStore';
import { getFieldMeta } from '../fieldTypes';
import { Trash2, Plus, AlertTriangle } from 'lucide-react';

interface FieldDetailsPanelProps {
  form: LeadForm;
  field: LeadFormField;
  onRemove?: () => void;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function newOptionId(): string {
  return `opt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

const PLACEHOLDER_TYPES = new Set([
  'text',
  'textarea',
  'email',
  'phone',
  'number',
  'date',
  'file',
]);

export function FieldDetailsPanel({ form, field, onRemove }: FieldDetailsPanelProps) {
  const updateField = useFormsStore((s) => s.updateField);
  const removeField = useFormsStore((s) => s.removeField);

  const meta = getFieldMeta(field.type);
  const validation: LeadFormValidation = field.validation ?? {};
  const options: LeadFormOption[] = field.options ?? [];

  const set = (updates: Partial<LeadFormField>): void => {
    void updateField(form.id, field.id, updates);
  };
  const setValidation = (updates: Partial<LeadFormValidation>): void => {
    set({ validation: { ...validation, ...updates } });
  };

  const updateOption = (idx: number, updates: Partial<LeadFormOption>): void => {
    const next = options.map((o, i) => (i === idx ? { ...o, ...updates } : o));
    set({ options: next });
  };
  const addOption = (): void => {
    const n = options.length + 1;
    const label = `Option ${n}`;
    set({ options: [...options, { id: newOptionId(), label, value: slugify(label) }] });
  };
  const removeOption = (idx: number): void => {
    set({ options: options.filter((_, i) => i !== idx) });
  };

  const showPlaceholder = PLACEHOLDER_TYPES.has(field.type);
  const showRequired = field.type !== 'submit' && field.type !== 'hidden';

  const handleRemove = (): void => {
    void removeField(form.id, field.id);
    onRemove?.();
  };

  const stopClick = (e: MouseEvent | KeyboardEvent): void => {
    e.stopPropagation();
  };

  return (
    <div className="forms-builder-field-details" onClick={stopClick} onKeyDown={stopClick}>
      <div className="forms-builder-inspector-section">
        <span className="forms-builder-inspector-section-title">Field</span>
        <div className="ui-field forms-field-group">
          <label className="forms-field-group-label">Label</label>
          <input
            className="ui-input forms-input"
            value={field.label}
            onChange={(e) => set({ label: e.target.value })}
          />
        </div>
        <div className="ui-field forms-field-group">
          <label className="forms-field-group-label">Name (key)</label>
          <input
            className="ui-input forms-input"
            value={field.name}
            onChange={(e) => set({ name: e.target.value })}
          />
        </div>
      </div>

      <div className="forms-builder-inspector-section">
        <span className="forms-builder-inspector-section-title">Display</span>
        {showPlaceholder && (
          <div className="ui-field forms-field-group">
            <label className="forms-field-group-label">Placeholder</label>
            <input
              className="ui-input forms-input"
              value={field.placeholder ?? ''}
              onChange={(e) => set({ placeholder: e.target.value || undefined })}
            />
          </div>
        )}
        <div className="ui-field forms-field-group">
          <label className="forms-field-group-label">Help text</label>
          <input
            className="ui-input forms-input"
            value={field.helpText ?? ''}
            onChange={(e) => set({ helpText: e.target.value || undefined })}
          />
        </div>
      </div>

      {showRequired && (
        <div className="forms-builder-inspector-section">
          <label className="forms-builder-checkbox-row">
            <input
              type="checkbox"
              checked={Boolean(field.required)}
              onChange={(e) => set({ required: e.target.checked })}
            />
            <span>Required</span>
          </label>
        </div>
      )}

      {meta.hasOptions && (
        <div className="forms-builder-inspector-section">
          <span className="forms-builder-inspector-section-title">Options</span>
          <div className="forms-builder-options-list">
            {options.map((opt, idx) => (
              <div key={opt.id} className="forms-builder-option-row">
                <input
                  className="ui-input forms-input"
                  value={opt.label}
                  placeholder="Label"
                  onChange={(e) =>
                    updateOption(idx, {
                      label: e.target.value,
                      value: slugify(e.target.value) || opt.value,
                    })
                  }
                />
                <input
                  className="ui-input forms-input"
                  value={opt.value}
                  placeholder="value"
                  onChange={(e) => updateOption(idx, { value: e.target.value })}
                />
                <button
                  type="button"
                  className="ui-icon-button forms-builder-field-card-btn ui-button--danger forms-builder-field-card-btn--danger"
                  title="Remove option"
                  onClick={() => removeOption(idx)}
                >
                  <Trash2 />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="ui-button forms-action-btn forms-action-btn--ghost"
            onClick={addOption}
          >
            <Plus /> Add option
          </button>
        </div>
      )}

      {(meta.hasNumericValidation || meta.hasTextValidation) && (
        <div className="forms-builder-inspector-section">
          <span className="forms-builder-inspector-section-title">Validation</span>
          {meta.hasNumericValidation && (
            <div className="forms-builder-control-grid">
              <div className="ui-field forms-field-group">
                <label className="forms-field-group-label">Min</label>
                <input
                  className="ui-input forms-input"
                  type="number"
                  value={validation.min ?? ''}
                  onChange={(e) =>
                    setValidation({ min: e.target.value === '' ? undefined : Number(e.target.value) })
                  }
                />
              </div>
              <div className="ui-field forms-field-group">
                <label className="forms-field-group-label">Max</label>
                <input
                  className="ui-input forms-input"
                  type="number"
                  value={validation.max ?? ''}
                  onChange={(e) =>
                    setValidation({ max: e.target.value === '' ? undefined : Number(e.target.value) })
                  }
                />
              </div>
            </div>
          )}
          {meta.hasTextValidation && (
            <>
              <div className="forms-builder-control-grid">
                <div className="ui-field forms-field-group">
                  <label className="forms-field-group-label">Min length</label>
                  <input
                    className="ui-input forms-input"
                    type="number"
                    value={validation.minLength ?? ''}
                    onChange={(e) =>
                      setValidation({
                        minLength: e.target.value === '' ? undefined : Number(e.target.value),
                      })
                    }
                  />
                </div>
                <div className="ui-field forms-field-group">
                  <label className="forms-field-group-label">Max length</label>
                  <input
                    className="ui-input forms-input"
                    type="number"
                    value={validation.maxLength ?? ''}
                    onChange={(e) =>
                      setValidation({
                        maxLength: e.target.value === '' ? undefined : Number(e.target.value),
                      })
                    }
                  />
                </div>
              </div>
              <div className="ui-field forms-field-group">
                <label className="forms-field-group-label">Pattern (regex)</label>
                <input
                  className="ui-input forms-input"
                  value={validation.pattern ?? ''}
                  placeholder="^[A-Za-z]+$"
                  onChange={(e) => setValidation({ pattern: e.target.value || undefined })}
                />
              </div>
            </>
          )}
          <div className="ui-field forms-field-group">
            <label className="forms-field-group-label">Error message</label>
            <input
              className="ui-input forms-input"
              value={validation.message ?? ''}
              onChange={(e) => setValidation({ message: e.target.value || undefined })}
            />
          </div>
        </div>
      )}

      <div className="forms-builder-inspector-section">
        <span className="forms-builder-inspector-section-title">Step</span>
        {form.steps.length === 0 ? (
          <p className="forms-field-group-hint">No steps defined. Add steps in the Logic tab.</p>
        ) : (
          <select
            className="ui-input forms-select"
            value={field.stepId ?? ''}
            onChange={(e) => set({ stepId: e.target.value || undefined })}
          >
            <option value="">No step (always visible)</option>
            {[...form.steps]
              .sort((a, b) => a.order - b.order)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title || `Step ${s.order + 1}`}
                </option>
              ))}
          </select>
        )}
      </div>

      <div className="forms-builder-inspector-section">
        <span className="forms-builder-inspector-section-title">Embed behavior</span>
        {field.type === 'file' && (
          <p className="forms-builder-inline-hint">
            <AlertTriangle /> File uploads render disabled in published embeds until VPS
            storage is connected.
          </p>
        )}
        <label className="forms-builder-checkbox-row">
          <input
            type="checkbox"
            checked={Boolean(field.disabledInPublishedEmbed)}
            onChange={(e) => set({ disabledInPublishedEmbed: e.target.checked })}
          />
          <span>Disabled in published embed</span>
        </label>
      </div>

      <div className="forms-builder-inspector-section">
        <button
          type="button"
          className="ui-button forms-action-btn ui-button--danger forms-action-btn--danger"
          onClick={handleRemove}
        >
          <Trash2 /> Delete field
        </button>
      </div>
    </div>
  );
}
