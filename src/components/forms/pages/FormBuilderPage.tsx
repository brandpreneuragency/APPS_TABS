// FormBuilderPage — thin entry for the Forms Builder sub-page.
// If no form is active, shows an empty state; otherwise mounts the FormBuilder
// shell, which reads the active form from the store itself.

import { useFormsStore } from '../../../stores/formsStore';
import { FormsEmptyState } from '../components/FormsEmptyState';
import FormBuilder from '../builder/FormBuilder';
import { FileEdit } from 'lucide-react';

export default function FormBuilderPage() {
  const activeFormId = useFormsStore((s) => s.activeFormId);
  const activeTemplateId = useFormsStore((s) => s.activeTemplateId);

  if (!activeFormId && !activeTemplateId) {
    return (
      <div className="ui-panel-body forms-page forms-page--builder" >
        <FormsEmptyState
          icon={FileEdit}
          title="No form or template selected"
          subtitle="Pick a form or template in the left panel to open the builder."
        />
      </div>
    );
  }

  return (
    <div className="ui-panel-body forms-page forms-page--builder" >
      <FormBuilder />
    </div>
  );
}
