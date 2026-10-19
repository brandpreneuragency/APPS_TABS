import { useEffect } from 'react';
import { UserPlus, X } from 'lucide-react';
import { useCrmStore } from '../../../stores/crmStore';
import { useFormsStore } from '../../../stores/formsStore';
import { CRMEmptyState } from '../components';
import { LeadDetail } from './LeadDetail';

interface LeadDetailModalProps {
  leadId: string | null;
  onClose: () => void;
}

export function LeadDetailModal({ leadId, onClose }: LeadDetailModalProps) {
  const { getLeadById } = useCrmStore();
  const { isLoaded: formsLoaded, loadForms } = useFormsStore();

  useEffect(() => {
    if (!formsLoaded) void loadForms();
  }, [formsLoaded, loadForms]);

  useEffect(() => {
    if (!leadId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [leadId, onClose]);

  if (!leadId) return null;

  const lead = getLeadById(leadId);

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="modal crm-lead-detail-modal flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Lead details"
      >
        <button
          type="button"
          className="ui-icon-button crm-lead-detail-modal-close modal-close"
          onClick={onClose}
          aria-label="Close"
        >
          <X />
        </button>

        <div className="crm-lead-detail-modal-body">
          {lead ? (
            <LeadDetail lead={lead} />
          ) : (
            <div className="crm-page">
              <CRMEmptyState
                icon={UserPlus}
                title="Lead not found"
                subtitle="This deal's linked lead may have been deleted."
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
