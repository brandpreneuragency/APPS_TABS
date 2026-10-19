import { ChevronUp, ChevronDown, Trash2, Plus, ChevronRight } from 'lucide-react';
import type { LeadForm, LeadFormField, LeadFormStep } from '../../../../types/forms';
import { getFieldIcon, getFieldLabel } from '../fieldTypes';
import { useFormsStore } from '../../../../stores/formsStore';
import { FieldDetailsPanel } from './FieldDetailsPanel';

interface FormCanvasProps {
  form: LeadForm;
  expandedFieldId: string | null;
  onToggleField: (id: string | null) => void;
}

const stepTitle = (step: LeadFormStep | undefined, idx: number): string =>
  step?.title?.trim() ? step.title : `Step ${idx + 1}`;

/** Groups fields by stepId, preserving order. Unassigned fields go first. */
function groupByStep(
  fields: LeadFormField[],
  steps: LeadFormStep[],
): Array<{ step: LeadFormStep | null; fields: LeadFormField[] }> {
  const sorted = [...fields].sort((a, b) => a.order - b.order);
  if (steps.length === 0) return [{ step: null, fields: sorted }];
  const byId = new Map<string, LeadFormStep>();
  steps.forEach((s) => byId.set(s.id, s));
  const orderedSteps = [...steps].sort((a, b) => a.order - b.order);
  const groups: Array<{ step: LeadFormStep | null; fields: LeadFormField[] }> = [];
  const unassigned = sorted.filter((f) => !f.stepId || !byId.has(f.stepId));
  if (unassigned.length > 0) groups.push({ step: null, fields: unassigned });
  for (const step of orderedSteps) {
    const fs = sorted.filter((f) => f.stepId === step.id);
    if (fs.length > 0) groups.push({ step, fields: fs });
  }
  return groups;
}

export function FormCanvas({ form, expandedFieldId, onToggleField }: FormCanvasProps) {
  const reorderFields = useFormsStore((s) => s.reorderFields);
  const removeField = useFormsStore((s) => s.removeField);

  const sortedFields = [...form.fields].sort((a, b) => a.order - b.order);
  const groups = groupByStep(form.fields, form.steps);

  const move = (fieldId: string, dir: -1 | 1) => {
    const idx = sortedFields.findIndex((f) => f.id === fieldId);
    if (idx < 0) return;
    const swapWith = idx + dir;
    if (swapWith < 0 || swapWith >= sortedFields.length) return;
    const ids = sortedFields.map((f) => f.id);
    [ids[idx], ids[swapWith]] = [ids[swapWith], ids[idx]];
    void reorderFields(form.id, ids);
  };

  const handleRemove = (fieldId: string) => {
    void removeField(form.id, fieldId);
    if (expandedFieldId === fieldId) onToggleField(null);
  };

  const handleToggle = (fieldId: string) => {
    onToggleField(expandedFieldId === fieldId ? null : fieldId);
  };

  return (
    <div className="forms-builder-col forms-builder-canvas-col">
      <div className="ui-toolbar forms-builder-col-head">
        <span className="forms-builder-col-head-title">Canvas</span>
        <span className="forms-builder-col-head-title" style={{ textTransform: 'none', letterSpacing: 0 }}>
          {sortedFields.length} field{sortedFields.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="ui-panel-body forms-builder-col-body">
        <div className="forms-builder-canvas">
          {sortedFields.length === 0 ? (
            <div className="forms-builder-canvas-empty">
              <Plus />
              <p className="forms-empty-state-title">No fields yet</p>
              <p className="forms-empty-state-subtitle">
                Click a field type in the palette on the left to add it here.
              </p>
            </div>
          ) : (
            groups.map((group, gIdx) => (
              <div key={group.step?.id ?? `__unassigned_${gIdx}`}>
                {group.step && (
                  <div className="forms-builder-step-sep">{stepTitle(group.step, gIdx)}</div>
                )}
                {group.fields.map((field) => {
                  const Icon = getFieldIcon(field.type);
                  const isExpanded = field.id === expandedFieldId;
                  const isDisabledInEmbed = Boolean(field.disabledInPublishedEmbed);
                  return (
                    <div
                      key={field.id}
                      className={`forms-builder-field-wrap${isExpanded ? ' forms-builder-field-wrap--expanded' : ''}`}
                    >
                      <div data-active={isExpanded}
                        className={"ui-card " + (`forms-builder-field-card${isExpanded ? ' forms-builder-field-card--active' : ''}` +
                          `${isDisabledInEmbed ? ' forms-builder-field-card--disabled' : ''}`)}
                        onClick={() => handleToggle(field.id)}
                        role="button"
                        tabIndex={0}
                        aria-expanded={isExpanded}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleToggle(field.id);
                          }
                        }}
                      >
                        <span
                          className={`forms-builder-field-card-chevron${isExpanded ? ' forms-builder-field-card-chevron--open' : ''}`}
                          aria-hidden="true"
                        >
                          <ChevronRight />
                        </span>
                        <span className="forms-builder-field-card-icon">
                          <Icon />
                        </span>
                        <div className="forms-builder-field-card-body">
                          <span className="forms-builder-field-card-label">
                            {field.label || '(untitled)'}
                            {field.required ? (
                              <span className="forms-builder-field-card-required" aria-label="required">*</span>
                            ) : null}
                          </span>
                          <span className="forms-builder-field-card-meta">
                            <span>{getFieldLabel(field.type)}</span>
                            <span className="forms-builder-field-card-name">name: {field.name}</span>
                            {field.placeholder ? <span>placeholder: “{field.placeholder}”</span> : null}
                            {isDisabledInEmbed ? <span>disabled in embed</span> : null}
                          </span>
                        </div>
                        <div className="forms-builder-field-card-actions">
                          <button
                            type="button"
                            className="ui-icon-button forms-builder-field-card-btn"
                            title="Move up"
                            onClick={(e) => {
                              e.stopPropagation();
                              move(field.id, -1);
                            }}
                          >
                            <ChevronUp />
                          </button>
                          <button
                            type="button"
                            className="ui-icon-button forms-builder-field-card-btn"
                            title="Move down"
                            onClick={(e) => {
                              e.stopPropagation();
                              move(field.id, 1);
                            }}
                          >
                            <ChevronDown />
                          </button>
                          <button
                            type="button"
                            className="ui-icon-button forms-builder-field-card-btn ui-button--danger forms-builder-field-card-btn--danger"
                            title="Remove field"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemove(field.id);
                            }}
                          >
                            <Trash2 />
                          </button>
                        </div>
                      </div>
                      {isExpanded && (
                        <FieldDetailsPanel
                          form={form}
                          field={field}
                          onRemove={() => onToggleField(null)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
