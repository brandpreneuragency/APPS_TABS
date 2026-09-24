// LocalSubmissionHandler — in-app test harness for a single form.
//
// Loads a form by id from the forms store (seeding via loadForms if the store
// is empty), then renders it inside a card so a user can submit the form
// locally and watch ingestion flow through submissionService into CRM records.
// This is the local-first equivalent of the future public VPS endpoint — the
// same FormRenderer + ingestSubmission path runs, just not over HTTP.

import { useEffect } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { FileQuestion, FlaskConical } from 'lucide-react';
import type { LeadForm } from '../../../types/forms';
import type { IngestionResult } from '../../../services/submissionService';
import { useFormsStore } from '../../../stores/formsStore';
import { useUIStore } from '../../../stores/uiStore';
import { FormRenderer } from './FormRenderer';

export interface LocalSubmissionHandlerProps {
  formId: string;
}

const shellStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  width: '100%',
  maxWidth: 720,
  margin: '0 auto',
};

const cardStyle: CSSProperties = {
  background: '#ffffff',
  border: '1px solid rgba(15, 23, 42, 0.12)',
  borderRadius: 'var(--radius-sm)',
  overflow: 'hidden',
};

const cardHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '14px 18px',
  borderBottom: '1px solid rgba(15, 23, 42, 0.10)',
  background: 'rgba(99, 102, 241, 0.06)',
};

const cardTitleStyle: CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  color: '#1e293b',
  lineHeight: 1.3,
};

const cardSubtitleStyle: CSSProperties = {
  fontSize: 12,
  color: '#64748b',
  marginTop: 2,
};

const cardBodyStyle: CSSProperties = {
  padding: 4,
};

const placeholderStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  padding: '48px 20px',
  color: '#64748b',
  fontSize: 14,
  textAlign: 'center',
  border: '1px dashed rgba(15, 23, 42, 0.18)',
  borderRadius: 'var(--radius-sm)',
  background: 'rgba(248, 250, 252, 0.6)',
};

export function LocalSubmissionHandler({ formId }: LocalSubmissionHandlerProps): ReactNode {
  const forms = useFormsStore((s) => s.forms);
  const isLoaded = useFormsStore((s) => s.isLoaded);
  const loadForms = useFormsStore((s) => s.loadForms);

  useEffect(() => {
    if (forms.length === 0) {
      void loadForms();
    }
  }, [forms.length, loadForms]);

  const form: LeadForm | undefined = forms.find((f) => f.id === formId);

  if (!isLoaded) {
    return (
      <div style={shellStyle}>
        <div style={placeholderStyle}>Loading form…</div>
      </div>
    );
  }

  if (!form) {
    return (
      <div style={shellStyle}>
        <div style={placeholderStyle}>
          <FileQuestion size={18} strokeWidth={2} />
          <span>Form not found</span>
        </div>
      </div>
    );
  }

  // CRM_FORMS_PUBLIC_CAPTURE_TODO:
  // The embed snippets are generated now, but production lead capture requires
  // a public VPS/API endpoint. Future backend agent must implement public form
  // rendering, allowed-domain validation, CORS policy, rate limiting, spam checks,
  // submission persistence, duplicate matching, and CRM lead creation.
  //
  // CRM_FORMS_WEBHOOK_DELIVERY_TODO:
  // Webhook settings are stored now, but delivery/retry/logging is deferred.
  // Future backend agent must implement signed payloads, timeout handling,
  // retry policy, webhook logs, failure states, and test-send action.
  const handleSubmitSuccess = (result: IngestionResult): void => {
    useUIStore
      .getState()
      .showToast('Submission received — lead ' + (result.leadId ?? 'created'), 'info');
  };

  return (
    <div style={shellStyle}>
      <div style={cardStyle}>
        <div style={cardHeaderStyle}>
          <FlaskConical size={16} strokeWidth={2} color="#4f46e5" />
          <div>
            <div style={cardTitleStyle}>Local submission test — {form.name}</div>
            <div style={cardSubtitleStyle}>
              Submissions run through ingestSubmission and create local CRM records.
            </div>
          </div>
        </div>
        <div style={cardBodyStyle}>
          <FormRenderer form={form} isPublishedEmbed={false} onSubmitSuccess={handleSubmitSuccess} />
        </div>
      </div>
    </div>
  );
}

export default LocalSubmissionHandler;
