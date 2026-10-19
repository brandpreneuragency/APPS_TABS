// SubmissionsTab — read-only list of submissions for the active form.
// Clicking a row navigates to the Forms Submissions page with the submission selected.

import type { LeadForm, LeadFormSubmission, FormSubmissionStatus } from '../../../types/forms';
import { useFormsStore } from '../../../stores/formsStore';
import { useUIStore } from '../../../stores/uiStore';
import { SpamBadge } from '../components/SpamBadge';
import { FormsEmptyState } from '../components/FormsEmptyState';
import { Inbox } from 'lucide-react';

const STATUS_LABEL: Record<FormSubmissionStatus, string> = {
  new: 'New',
  converted: 'Converted',
  spam: 'Spam',
};

function summaryValue(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

export default function SubmissionsTab({ form }: { form: LeadForm }) {
  const submissions = useFormsStore((s) => s.submissions);
  const setActiveSubmissionId = useFormsStore((s) => s.setActiveSubmissionId);
  const setActiveFormsPage = useUIStore((s) => s.setActiveFormsPage);

  const formSubs = submissions
    .filter((s) => s.formId === form.id)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const summaryFields = [...form.fields]
    .sort((a, b) => a.order - b.order)
    .slice(0, 3)
    .filter((f) => f.type !== 'hidden' && f.type !== 'submit');

  const handleOpen = (sub: LeadFormSubmission): void => {
    setActiveSubmissionId(sub.id);
    setActiveFormsPage('submissions');
  };

  if (formSubs.length === 0) {
    return (
      <div className="forms-builder-submissions">
        <FormsEmptyState
          icon={Inbox}
          title="No submissions yet"
          subtitle="Submissions to this form will appear here. Open the Submissions page to manage all entries."
        />
      </div>
    );
  }

  return (
    <div className="forms-builder-submissions">
      <div className="ui-toolbar forms-builder-submissions-toolbar">
        <span className="forms-builder-col-head-title">
          {formSubs.length} submission{formSubs.length === 1 ? '' : 's'}
        </span>
        <button
          type="button"
          className="ui-button forms-action-btn forms-action-btn--ghost"
          onClick={() => setActiveFormsPage('submissions')}
        >
          Open Submissions page
        </button>
      </div>
      <div className="forms-table-wrap">
        <table className="forms-table">
          <thead>
            <tr>
              <th>Submitted</th>
              <th>Source</th>
              <th>Status</th>
              <th>Spam</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {formSubs.map((sub) => (
              <tr key={sub.id} onClick={() => handleOpen(sub)}>
                <td>
                  <div className="forms-builder-submission-summary">
                    {summaryFields.map((f) => {
                      const val = summaryValue(sub.fields[f.name]);
                      if (val === null) return null;
                      return (
                        <span key={f.id} className="forms-builder-submission-summary-item">
                          <span className="forms-builder-submission-summary-label">{f.label}</span>
                          <span className="forms-builder-submission-summary-value">{val}</span>
                        </span>
                      );
                    })}
                    {summaryFields.length === 0 && (
                      <span className="forms-muted">(no fields)</span>
                    )}
                  </div>
                </td>
                <td>{sub.sourceDomain ?? '—'}</td>
                <td>
                  <span
                    className={`forms-builder-submission-status forms-builder-submission-status--${sub.status}`}
                  >
                    {STATUS_LABEL[sub.status]}
                  </span>
                </td>
                <td>
                  <SpamBadge spamScore={sub.spamScore} />
                </td>
                <td className="forms-builder-submission-time">
                  {new Date(sub.createdAt).toLocaleString('tr-TR')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
