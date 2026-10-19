import { Trash2, Eye, EyeOff, Ban } from 'lucide-react';
import type {
  LeadForm,
  LeadFormLogicRule,
  LogicRuleOperator,
  LogicRuleType,
  LeadFormField,
} from '../../../../types/forms';

interface LogicRuleEditorProps {
  form: LeadForm;
  rule: LeadFormLogicRule;
  onChange: (rule: LeadFormLogicRule) => void;
  onDelete: () => void;
}

type SimplifiedAction = 'show' | 'hide' | 'block';

const OPERATORS: { value: LogicRuleOperator; label: string }[] = [
  { value: 'eq', label: 'equals' },
  { value: 'neq', label: 'not equals' },
  { value: 'contains', label: 'contains' },
  { value: 'gt', label: 'greater than' },
  { value: 'lt', label: 'less than' },
  { value: 'gte', label: '>= (gte)' },
  { value: 'lte', label: '<= (lte)' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
];

const ACTIONS: { value: SimplifiedAction; label: string; icon: typeof Eye }[] = [
  { value: 'show', label: 'Show field', icon: Eye },
  { value: 'hide', label: 'Hide field', icon: EyeOff },
  { value: 'block', label: 'Block submit', icon: Ban },
];

const TYPE_BY_ACTION: Record<SimplifiedAction, LogicRuleType> = {
  show: 'show_field',
  hide: 'hide_field',
  block: 'block_submit',
};

const ACTION_BY_TYPE: Partial<Record<LogicRuleType, SimplifiedAction>> = {
  show_field: 'show',
  hide_field: 'hide',
  show_step: 'show',
  hide_step: 'hide',
  block_submit: 'block',
};

/** Fields usable as trigger or target (excludes hidden + submit). */
function editableFields(form: LeadForm): LeadFormField[] {
  return form.fields
    .filter((f) => f.type !== 'hidden' && f.type !== 'submit')
    .sort((a, b) => a.order - b.order);
}

function isEmptyOp(op: LogicRuleOperator): boolean {
  return op === 'is_empty' || op === 'is_not_empty';
}

export function LogicRuleEditor({ form, rule, onChange, onDelete }: LogicRuleEditorProps) {
  const fields = editableFields(form);
  const action: SimplifiedAction = ACTION_BY_TYPE[rule.type] ?? 'show';
  const isBlock = action === 'block';
  const valueHidden = isEmptyOp(rule.operator);

  const patch = (updates: Partial<LeadFormLogicRule>) => onChange({ ...rule, ...updates });

  const handleActionChange = (next: SimplifiedAction) => {
    const type = TYPE_BY_ACTION[next];
    if (next === 'block') {
      patch({
        type,
        targetFieldIds: undefined,
        targetStepId: undefined,
        message: rule.message ?? 'Submission blocked by a form rule.',
      });
    } else {
      patch({
        type,
        targetFieldIds: rule.targetFieldIds ?? [],
        targetStepId: undefined,
        message: undefined,
      });
    }
  };

  const handleTargetChange = (targetId: string) => {
    patch({ targetFieldIds: [targetId] });
  };

  return (
    <div className="ui-card forms-builder-logic-rule-wrap">
      <div className="forms-builder-logic-rule-top">
        <span className="forms-builder-logic-rule-label">If</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label className="forms-builder-logic-rule-toggle">
            <input
              type="checkbox"
              className="forms-builder-logic-utm-checkbox"
              checked={rule.enabled}
              onChange={(e) => patch({ enabled: e.target.checked })}
            />
            Enabled
          </label>
          <button
            type="button"
            className="ui-icon-button forms-builder-logic-step-btn ui-button--danger forms-builder-logic-step-btn--danger"
            onClick={onDelete}
            aria-label="Delete rule"
            title="Delete rule"
          >
            <Trash2 />
          </button>
        </div>
      </div>

      <div className="forms-builder-logic-rule-grid">
        <div className="ui-field forms-builder-logic-rule-field">
          <span className="forms-builder-logic-rule-field-label">Source field</span>
          <select
            className="ui-input forms-builder-logic-select"
            value={rule.triggerFieldId}
            onChange={(e) => patch({ triggerFieldId: e.target.value })}
          >
            {fields.length === 0 ? (
              <option value="">No fields</option>
            ) : (
              fields.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label || f.name}
                </option>
              ))
            )}
          </select>
        </div>

        <div className="ui-field forms-builder-logic-rule-field">
          <span className="forms-builder-logic-rule-field-label">Operator</span>
          <select
            className="ui-input forms-builder-logic-select"
            value={rule.operator}
            onChange={(e) => {
              const op = e.target.value as LogicRuleOperator;
              patch({ operator: op, ...(isEmptyOp(op) ? { value: undefined } : {}) });
            }}
          >
            {OPERATORS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {!valueHidden && (
          <div className="ui-field forms-builder-logic-rule-field">
            <span className="forms-builder-logic-rule-field-label">Value</span>
            <input
              type="text"
              className="ui-input forms-builder-logic-input"
              value={rule.value === undefined ? '' : String(rule.value)}
              placeholder="Compare value"
              onChange={(e) => patch({ value: e.target.value })}
            />
          </div>
        )}

        <div className="ui-field forms-builder-logic-rule-field">
          <span className="forms-builder-logic-rule-field-label">Action</span>
          <select
            className="ui-input forms-builder-logic-select"
            value={action}
            onChange={(e) => handleActionChange(e.target.value as SimplifiedAction)}
          >
            {ACTIONS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </div>

        {!isBlock && (
          <div className="ui-field forms-builder-logic-rule-field">
            <span className="forms-builder-logic-rule-field-label">Target field</span>
            <select
              className="ui-input forms-builder-logic-select"
              value={rule.targetFieldIds?.[0] ?? ''}
              onChange={(e) => handleTargetChange(e.target.value)}
            >
              <option value="">— select —</option>
              {fields.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label || f.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {isBlock && (
          <div className="ui-field forms-builder-logic-rule-field forms-builder-logic-rule-message">
            <span className="forms-builder-logic-rule-field-label">Block message</span>
            <input
              type="text"
              className="ui-input forms-builder-logic-input"
              value={rule.message ?? ''}
              placeholder="Shown when submit is blocked"
              onChange={(e) => patch({ message: e.target.value })}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default LogicRuleEditor;
