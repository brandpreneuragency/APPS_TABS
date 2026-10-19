// CRM data model types.
// Local-first TABS CRM module. Lead, Contact, Company, and Deal are kept
// SEPARATE per docs/03-data-model-and-state.md (do not merge):
//   - Lead    = the sales/inquiry object
//   - Contact = the person
//   - Company = the organization
//   - Deal    = the pipeline opportunity
//   - Submission = raw form data (lives in forms.ts)
//
// Timestamps are ISO 8601 strings (`createdAt` / `updatedAt` / `lastActivityAt`)
// per the CRM data-model spec. IDs are `string` (nanoid) to match the rest of
// the app's `id: string` convention.

export type CRMLeadStatus =
  | 'new'
  | 'contacted'
  | 'qualified'
  | 'proposal'
  | 'won'
  | 'lost'
  | 'spam';

export type CRMDealStage =
  | 'new'
  | 'contacted'
  | 'qualified'
  | 'proposal'
  | 'won'
  | 'lost'
  | 'spam';

export type CRMActivityType =
  | 'lead_created'
  | 'lead_updated'
  | 'contact_created'
  | 'company_created'
  | 'deal_created'
  | 'deal_stage_changed'
  | 'form_submitted'
  | 'note_added'
  | 'task_linked'
  | 'ai_suggestion_applied'
  | 'export_created'
  | 'email_sent'
  | 'email_opened';

/** UTM / source attribution captured from form submissions and stored on leads. */
export interface CRMUtmData {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  referrer?: string;
  landing_page?: string;
  page_url?: string;
  device_type?: string;
  submitted_at?: string;
}

export interface CRMContact {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  jobTitle?: string;
  companyId?: string;
  lifecycleStatus?: string;
  tags: string[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
  lastActivityAt?: string;
}

export interface CRMCompany {
  id: string;
  name: string;
  website?: string;
  industry?: string;
  size?: string;
  city?: string;
  country?: string;
  ownerId?: string;
  tags: string[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
  lastActivityAt?: string;
}

export interface CRMLead {
  id: string;
  contactId?: string;
  companyId?: string;
  title: string;
  status: CRMLeadStatus;
  stage: CRMDealStage;
  score?: number;
  ownerId?: string;
  tags: string[];
  source?: string;
  sourceFormId?: string;
  sourceSubmissionId?: string;
  sourcePageUrl?: string;
  utm?: CRMUtmData;
  customFields?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  lastActivityAt?: string;
}

/**
 * CRMDeal is the pipeline opportunity. Also exported as `PipelineItem` so the
 * pipeline UI can refer to kanban cards by a domain-friendly name.
 */
export interface CRMDeal {
  id: string;
  order?: number;
  title: string;
  leadId?: string;
  contactId?: string;
  companyId?: string;
  stage: CRMDealStage;
  value?: number;
  currency?: string;
  probability?: number;
  expectedCloseDate?: string;
  ownerId?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export type PipelineItem = CRMDeal;

export interface CRMNote {
  id: string;
  body: string;
  leadId?: string;
  contactId?: string;
  companyId?: string;
  dealId?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CRMActivity {
  id: string;
  type: CRMActivityType;
  title: string;
  description?: string;
  leadId?: string;
  contactId?: string;
  companyId?: string;
  dealId?: string;
  formId?: string;
  submissionId?: string;
  taskId?: string;
  createdAt: string;
  createdBy?: string;
  metadata?: Record<string, unknown>;
}

/** Links a CRM object (lead/contact/company/deal) to a task in the task module. */
export interface CRMTaskLink {
  id: string;
  taskId: string;
  leadId?: string;
  contactId?: string;
  companyId?: string;
  dealId?: string;
  createdBy?: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Pipeline stages
// ---------------------------------------------------------------------------

export interface PipelineStage {
  id: string;
  key: CRMDealStage;
  label: string;
  order: number;
  isWon: boolean;
  isLost: boolean;
  isSpam: boolean;
}

// ---------------------------------------------------------------------------
// Saved views + filters
// ---------------------------------------------------------------------------

export type CRMEntityKind = 'lead' | 'contact' | 'company' | 'deal' | 'activity';

export type CRMFilterOperator =
  | 'eq'
  | 'neq'
  | 'contains'
  | 'in'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'between';

export interface CRMFilterRule {
  id: string;
  field: string;
  operator: CRMFilterOperator;
  value: string | number | boolean | string[];
}

export interface CRMFilterSet {
  entity: CRMEntityKind;
  conjunction: 'and' | 'or';
  rules: CRMFilterRule[];
}

export interface CRMSavedView {
  id: string;
  name: string;
  entity: CRMEntityKind;
  filters: CRMFilterSet;
  /** Optional column ordering for table views. */
  columns?: string[];
  isDefault?: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Dashboard derived shape (returned by selectors, not persisted)
// ---------------------------------------------------------------------------

export interface CRMDashboardKPIs {
  newLeads: number;
  openDeals: number;
  totalPipelineValue: number;
  weightedPipelineValue: number;
  conversionRate: number;
  wonDealsValue: number;
  tasksDue: number;
}
