import { useEffect } from 'react';
import { useFormsStore } from '../../../stores/formsStore';
import { useCrmStore } from '../../../stores/crmStore';
import { useUIStore } from '../../../stores/uiStore';
import { SubmissionDetail } from '../detail/SubmissionDetail';
import { FormsEmptyState } from '../components/FormsEmptyState';
import { Inbox, Download } from 'lucide-react';
import '../forms.css';

export default function FormsSubmissionsPage() {
  const isLoaded = useFormsStore((s) => s.isLoaded);
  const loadForms = useFormsStore((s) => s.loadForms);
  const submissions = useFormsStore((s) => s.submissions);
  const activeSubmissionId = useFormsStore((s) => s.activeSubmissionId);
  const submission = useFormsStore((s) => s.getSubmissionById(activeSubmissionId));
  const getFormById = useFormsStore((s) => s.getFormById);
  const exportSubmissions = useFormsStore((s) => s.exportSubmissions);
  const showToast = useUIStore((s) => s.showToast);

  const crmLoaded = useCrmStore((s) => s.isLoaded);
  const loadCrm = useCrmStore((s) => s.loadCrm);

  useEffect(() => {
    if (!isLoaded) void loadForms();
  }, [isLoaded, loadForms]);

  // CRM data is read-only here (linked lead/contact/company). Load once so
  // the SubmissionDetail can resolve links without a separate fetch per row.
  useEffect(() => {
    if (!crmLoaded) void loadCrm();
  }, [crmLoaded, loadCrm]);

  const handleExport = async () => {
    await exportSubmissions();
    showToast('Submissions exported to CSV.', 'info');
  };

  return (
    <div className="ui-panel-body forms-page forms-page--scroll" >
      <div
        className="forms-spread"
        style={{ padding: '14px 22px 6px', flexShrink: 0 }}
      >
        <div className="forms-stack" style={{ gap: 2 }}>
          <h2 className="forms-page-title">Submissions</h2>
          <p className="forms-page-subtitle">
            {submissions.length} submission{submissions.length === 1 ? '' : 's'} total
          </p>
        </div>
        <button
          type="button"
          className="ui-button forms-action-btn"
          onClick={handleExport}
          disabled={submissions.length === 0}
          title="Export all submissions to CSV"
        >
          <Download /> Export CSV
        </button>
      </div>

      {submission ? (
        <SubmissionDetail
          key={submission.id}
          submission={submission}
          form={getFormById(submission.formId)}
        />
      ) : (
        <FormsEmptyState
          icon={Inbox}
          title="Select a submission"
          subtitle="Pick a submission from the list on the left to inspect its fields, source data, spam score and linked CRM records."
        />
      )}
    </div>
  );
}
