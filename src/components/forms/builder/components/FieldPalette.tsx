import { FIELD_TYPE_META, newFieldInput } from '../fieldTypes';
import type { FormFieldType, LeadFormField } from '../../../../types/forms';
import { useFormsStore } from '../../../../stores/formsStore';

interface FieldPaletteProps {
  formId: string;
  existingFields: LeadFormField[];
}

export function FieldPalette({ formId, existingFields }: FieldPaletteProps) {
  const addField = useFormsStore((s) => s.addField);

  const handleAdd = (type: FormFieldType) => {
    const existingNames = existingFields.map((f) => f.name);
    const input = newFieldInput(type, existingNames);
    void addField(formId, input);
  };

  return (
    <div className="forms-builder-col forms-builder-palette">
      <div className="ui-toolbar forms-builder-col-head">
        <span className="forms-builder-col-head-title">Fields</span>
      </div>
      <div className="ui-panel-body forms-builder-col-body">
        <div className="forms-builder-palette-list">
          {FIELD_TYPE_META.map((meta) => {
            const Icon = meta.icon;
            return (
              <button
                key={meta.type}
                type="button"
                title={`Add ${meta.label} field`}
                onClick={() => handleAdd(meta.type)}
                className="ui-button forms-builder-palette-btn"
              >
                <span className="forms-builder-palette-btn-icon">
                  <Icon />
                </span>
                <span>{meta.label}</span>
              </button>
            );
          })}
        </div>
        <p className="forms-builder-palette-hint">
          Click a field to add it to the form. Expand a field on the canvas to configure it.
        </p>
      </div>
    </div>
  );
}
