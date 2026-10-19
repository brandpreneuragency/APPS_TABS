// CRM store. Local-first using Dexie (Tauri desktop).
// State + CRUD actions that delegate to crmService. UI components subscribe
// to this store; the store is the only layer that talks to the service.

import { create } from 'zustand';
import type {
  CRMLead,
  CRMContact,
  CRMCompany,
  CRMDeal,
  CRMActivity,
  CRMNote,
  CRMTaskLink,
  CRMSavedView,
  CRMLeadStatus,
  CRMDealStage,
  PipelineStage,
  CRMDashboardKPIs,
  CRMFilterSet,
} from '../types/crm';
import * as crmService from '../services/crmService';
import { useUIStore } from './uiStore';

function showError(err: unknown, fallback: string): void {
  const msg = err instanceof Error ? err.message : fallback;
  useUIStore.getState().showToast(msg, 'error');
}

export type CRMPipelineViewMode = 'kanban' | 'list';
export type CRMLeadsCenterView = 'lead' | 'pipeline';
export type CRMLeadScoreBand = 'high' | 'med' | 'low' | 'none';

export interface CRMFilters {
  lead: {
    status?: CRMLeadStatus;
    stage?: CRMDealStage;
    scoreBand?: CRMLeadScoreBand;
    ownerId?: string;
    search?: string;
    tags?: string[];
  };
  deal: {
    stage?: CRMDealStage;
    ownerId?: string;
    search?: string;
  };
  contact: {
    search?: string;
    companyId?: string;
  };
  company: {
    search?: string;
    industry?: string;
  };
  activity: {
    type?: CRMActivity['type'];
  };
}

interface CrmStore {
  // collections
  leads: CRMLead[];
  contacts: CRMContact[];
  companies: CRMCompany[];
  deals: CRMDeal[];
  activities: CRMActivity[];
  notes: CRMNote[];
  taskLinks: CRMTaskLink[];
  savedViews: CRMSavedView[];
  pipelineStages: PipelineStage[];

  // active selection
  activeLeadId: string | null;
  activeContactId: string | null;
  activeCompanyId: string | null;
  activeDealId: string | null;
  activePipelineView: CRMPipelineViewMode;
  /** Center panel mode while on the Leads page (lead detail vs pipeline board). */
  leadsCenterView: CRMLeadsCenterView;

  // filters
  filters: CRMFilters;
  activeSavedViewId: string | null;

  isLoaded: boolean;

  // bootstrap
  loadCrm: () => Promise<void>;

  // selection
  setActiveLeadId: (id: string | null) => void;
  setActiveContactId: (id: string | null) => void;
  setActiveCompanyId: (id: string | null) => void;
  setActiveDealId: (id: string | null) => void;
  setActivePipelineView: (mode: CRMPipelineViewMode) => void;
  setLeadsCenterView: (view: CRMLeadsCenterView) => void;

  // filters
  setLeadFilters: (filters: Partial<CRMFilters['lead']>) => void;
  setDealFilters: (filters: Partial<CRMFilters['deal']>) => void;
  setContactFilters: (filters: Partial<CRMFilters['contact']>) => void;
  setCompanyFilters: (filters: Partial<CRMFilters['company']>) => void;
  setActivityFilters: (filters: Partial<CRMFilters['activity']>) => void;
  applySavedView: (viewId: string | null) => void;
  clearFilters: () => void;

  // lead CRUD
  createLead: (input: Parameters<typeof crmService.createLead>[0]) => Promise<CRMLead | null>;
  updateLead: (id: string, updates: Partial<CRMLead>) => Promise<void>;
  setLeadStatus: (id: string, status: CRMLeadStatus) => Promise<void>;
  deleteLead: (id: string) => Promise<void>;

  // contact CRUD
  createContact: (input: Parameters<typeof crmService.createContact>[0]) => Promise<CRMContact | null>;
  updateContact: (id: string, updates: Partial<CRMContact>) => Promise<void>;
  deleteContact: (id: string) => Promise<void>;

  // company CRUD
  createCompany: (input: Parameters<typeof crmService.createCompany>[0]) => Promise<CRMCompany | null>;
  updateCompany: (id: string, updates: Partial<CRMCompany>) => Promise<void>;
  deleteCompany: (id: string) => Promise<void>;

  // deal CRUD
  createDeal: (input: Parameters<typeof crmService.createDeal>[0]) => Promise<CRMDeal | null>;
  updateDeal: (id: string, updates: Partial<CRMDeal>) => Promise<void>;
  setDealStage: (id: string, stage: CRMDealStage, beforeId?: string | null) => Promise<void>;
  deleteDeal: (id: string) => Promise<void>;

  // notes + task links
  addNote: (input: Parameters<typeof crmService.addNote>[0]) => Promise<CRMNote | null>;
  deleteNote: (id: string) => Promise<void>;
  linkTask: (input: Parameters<typeof crmService.linkTask>[0]) => Promise<CRMTaskLink | null>;
  unlinkTask: (id: string) => Promise<void>;

  // saved views
  createSavedView: (input: Parameters<typeof crmService.createSavedView>[0]) => Promise<CRMSavedView | null>;
  deleteSavedView: (id: string) => Promise<void>;

  // export
  exportLeads: () => Promise<void>;

  // selectors (pure, read from current state)
  getLeadById: (id: string | null) => CRMLead | undefined;
  getContactById: (id: string | null) => CRMContact | undefined;
  getCompanyById: (id: string | null) => CRMCompany | undefined;
  getDealById: (id: string | null) => CRMDeal | undefined;
  selectLeadsByStage: () => Record<CRMDealStage, CRMLead[]>;
  selectDealsByStage: () => Record<CRMDealStage, CRMDeal[]>;
  selectDashboardKPIs: (tasksDue?: number) => CRMDashboardKPIs;
  selectActivitiesForLead: (leadId: string) => CRMActivity[];
  selectNotesForLead: (leadId: string) => CRMNote[];
}

function emptyFilters(): CRMFilters {
  return {
    lead: {},
    deal: {},
    contact: {},
    company: {},
    activity: {},
  };
}

export const useCrmStore = create<CrmStore>((set, get) => ({
  leads: [],
  contacts: [],
  companies: [],
  deals: [],
  activities: [],
  notes: [],
  taskLinks: [],
  savedViews: [],
  pipelineStages: [],
  activeLeadId: null,
  activeContactId: null,
  activeCompanyId: null,
  activeDealId: null,
  activePipelineView: 'kanban',
  leadsCenterView: 'lead',
  filters: emptyFilters(),
  activeSavedViewId: null,
  isLoaded: false,

  loadCrm: async () => {
    try {
      await crmService.ensureCrmSeeded();
      const [
        leads,
        contacts,
        companies,
        deals,
        activities,
        notes,
        taskLinks,
        savedViews,
        pipelineStages,
      ] = await Promise.all([
        crmService.listLeads(),
        crmService.listContacts(),
        crmService.listCompanies(),
        crmService.listDeals(),
        crmService.listActivities(),
        crmService.listNotes(),
        crmService.listTaskLinks(),
        crmService.listSavedViews(),
        crmService.getPipelineStages(),
      ]);
      set({
        leads,
        contacts,
        companies,
        deals,
        activities,
        notes,
        taskLinks,
        savedViews,
        pipelineStages,
        isLoaded: true,
      });
    } catch (err) {
      set({ isLoaded: true });
      showError(err, 'Failed to load CRM data.');
    }
  },

  setActiveLeadId: (id) =>
    set((s) => ({
      activeLeadId: id,
      leadsCenterView: id ? 'lead' : s.leadsCenterView,
    })),
  setActiveContactId: (id) => set({ activeContactId: id }),
  setActiveCompanyId: (id) => set({ activeCompanyId: id }),
  setActiveDealId: (id) => set({ activeDealId: id }),
  setActivePipelineView: (mode) => set({ activePipelineView: mode }),
  setLeadsCenterView: (view) =>
    set((s) => ({
      leadsCenterView: view,
      activeLeadId: view === 'pipeline' ? null : s.activeLeadId,
    })),

  setLeadFilters: (filters) =>
    set((s) => ({ filters: { ...s.filters, lead: { ...s.filters.lead, ...filters } } })),
  setDealFilters: (filters) =>
    set((s) => ({ filters: { ...s.filters, deal: { ...s.filters.deal, ...filters } } })),
  setContactFilters: (filters) =>
    set((s) => ({ filters: { ...s.filters, contact: { ...s.filters.contact, ...filters } } })),
  setCompanyFilters: (filters) =>
    set((s) => ({ filters: { ...s.filters, company: { ...s.filters.company, ...filters } } })),
  setActivityFilters: (filters) =>
    set((s) => ({ filters: { ...s.filters, activity: { ...s.filters.activity, ...filters } } })),
  applySavedView: (viewId) => {
    if (!viewId) {
      set({ activeSavedViewId: null, filters: emptyFilters() });
      return;
    }
    const view = get().savedViews.find((v) => v.id === viewId);
    if (!view) return;
    set({ activeSavedViewId: viewId, filters: applyViewToFilters(view.filters, get().filters) });
  },
  clearFilters: () => set({ filters: emptyFilters(), activeSavedViewId: null }),

  createLead: async (input) => {
    try {
      const lead = await crmService.createLead(input);
      const activities = await crmService.listActivities();
      set((s) => ({ leads: [...s.leads, lead], activities, activeLeadId: lead.id }));
      return lead;
    } catch (err) {
      showError(err, 'Failed to create lead.');
      return null;
    }
  },

  updateLead: async (id, updates) => {
    const previous = get().leads.find((l) => l.id === id);
    set((s) => ({
      leads: s.leads.map((l) => (l.id === id ? { ...l, ...updates, id } : l)),
    }));
    try {
      const next = await crmService.updateLead(id, updates);
      if (next) {
        set((s) => ({ leads: s.leads.map((l) => (l.id === id ? next : l)) }));
      }
    } catch (err) {
      if (previous) {
        set((s) => ({ leads: s.leads.map((l) => (l.id === id ? previous : l)) }));
      }
      showError(err, 'Failed to update lead.');
    }
  },

  setLeadStatus: async (id, status) => {
    try {
      const next = await crmService.setLeadStatus(id, status);
      if (next) {
        set((s) => ({ leads: s.leads.map((l) => (l.id === id ? next : l)) }));
      }
    } catch (err) {
      showError(err, 'Failed to update lead status.');
    }
  },

  deleteLead: async (id) => {
    set((s) => ({
      leads: s.leads.filter((l) => l.id !== id),
      activities: s.activities.filter((a) => a.leadId !== id),
      notes: s.notes.filter((n) => n.leadId !== id),
    }));
    try {
      await crmService.deleteLead(id);
    } catch (err) {
      showError(err, 'Failed to delete lead.');
      // Best-effort reload to restore consistent state.
      void get().loadCrm();
    }
  },

  createContact: async (input) => {
    try {
      const contact = await crmService.createContact(input);
      const activities = await crmService.listActivities();
      set((s) => ({ contacts: [...s.contacts, contact], activities, activeContactId: contact.id }));
      return contact;
    } catch (err) {
      showError(err, 'Failed to create contact.');
      return null;
    }
  },

  updateContact: async (id, updates) => {
    const previous = get().contacts.find((c) => c.id === id);
    set((s) => ({
      contacts: s.contacts.map((c) => (c.id === id ? { ...c, ...updates, id } : c)),
    }));
    try {
      const next = await crmService.updateContact(id, updates);
      if (next) {
        set((s) => ({ contacts: s.contacts.map((c) => (c.id === id ? next : c)) }));
      }
    } catch (err) {
      if (previous) {
        set((s) => ({ contacts: s.contacts.map((c) => (c.id === id ? previous : c)) }));
      }
      showError(err, 'Failed to update contact.');
    }
  },

  deleteContact: async (id) => {
    set((s) => ({
      contacts: s.contacts.filter((c) => c.id !== id),
      activities: s.activities.filter((a) => a.contactId !== id),
      notes: s.notes.filter((n) => n.contactId !== id),
    }));
    try {
      await crmService.deleteContact(id);
    } catch (err) {
      showError(err, 'Failed to delete contact.');
      void get().loadCrm();
    }
  },

  createCompany: async (input) => {
    try {
      const company = await crmService.createCompany(input);
      const activities = await crmService.listActivities();
      set((s) => ({ companies: [...s.companies, company], activities, activeCompanyId: company.id }));
      return company;
    } catch (err) {
      showError(err, 'Failed to create company.');
      return null;
    }
  },

  updateCompany: async (id, updates) => {
    const previous = get().companies.find((c) => c.id === id);
    set((s) => ({
      companies: s.companies.map((c) => (c.id === id ? { ...c, ...updates, id } : c)),
    }));
    try {
      const next = await crmService.updateCompany(id, updates);
      if (next) {
        set((s) => ({ companies: s.companies.map((c) => (c.id === id ? next : c)) }));
      }
    } catch (err) {
      if (previous) {
        set((s) => ({ companies: s.companies.map((c) => (c.id === id ? previous : c)) }));
      }
      showError(err, 'Failed to update company.');
    }
  },

  deleteCompany: async (id) => {
    set((s) => ({
      companies: s.companies.filter((c) => c.id !== id),
      activities: s.activities.filter((a) => a.companyId !== id),
      notes: s.notes.filter((n) => n.companyId !== id),
    }));
    try {
      await crmService.deleteCompany(id);
    } catch (err) {
      showError(err, 'Failed to delete company.');
      void get().loadCrm();
    }
  },

  createDeal: async (input) => {
    try {
      const deal = await crmService.createDeal(input);
      const activities = await crmService.listActivities();
      set((s) => ({ deals: [...s.deals, deal], activities, activeDealId: deal.id }));
      return deal;
    } catch (err) {
      showError(err, 'Failed to create deal.');
      return null;
    }
  },

  updateDeal: async (id, updates) => {
    const previous = get().deals.find((d) => d.id === id);
    set((s) => ({
      deals: s.deals.map((d) => (d.id === id ? { ...d, ...updates, id } : d)),
    }));
    try {
      const next = await crmService.updateDeal(id, updates);
      if (next) {
        set((s) => ({
          deals: s.deals.map((d) => (d.id === id ? next : d)),
          // a stage change may also sync the linked lead's stage
          leads: next.leadId
            ? s.leads.map((l) => (l.id === next.leadId && next.stage ? { ...l, stage: next.stage, status: next.stage } : l))
            : s.leads,
        }));
      }
    } catch (err) {
      if (previous) {
        set((s) => ({ deals: s.deals.map((d) => (d.id === id ? previous : d)) }));
      }
      showError(err, 'Failed to update deal.');
    }
  },

  setDealStage: async (id, stage, beforeId) => {
    try {
      const next = await crmService.setDealStage(id, stage, beforeId);
      if (next) {
        const orders = beforeId === undefined ? new Map<string, number | undefined>()
          : new Map((await crmService.listDeals()).map((deal) => [deal.id, deal.order]));
        set((s) => ({
          deals: s.deals.map((deal) => deal.id === id ? next
            : orders.has(deal.id) ? { ...deal, order: orders.get(deal.id) } : deal),
          leads: next.leadId
            ? s.leads.map((l) => (l.id === next.leadId ? { ...l, stage, status: stage } : l))
            : s.leads,
        }));
      }
    } catch (err) {
      showError(err, 'Failed to move deal.');
    }
  },

  deleteDeal: async (id) => {
    set((s) => ({ deals: s.deals.filter((d) => d.id !== id) }));
    try {
      await crmService.deleteDeal(id);
    } catch (err) {
      showError(err, 'Failed to delete deal.');
      void get().loadCrm();
    }
  },

  addNote: async (input) => {
    try {
      const note = await crmService.addNote(input);
      const activities = await crmService.listActivities();
      set((s) => ({ notes: [note, ...s.notes], activities }));
      return note;
    } catch (err) {
      showError(err, 'Failed to add note.');
      return null;
    }
  },

  deleteNote: async (id) => {
    set((s) => ({ notes: s.notes.filter((n) => n.id !== id) }));
    try {
      await crmService.deleteNote(id);
    } catch (err) {
      showError(err, 'Failed to delete note.');
      void get().loadCrm();
    }
  },

  linkTask: async (input) => {
    try {
      const link = await crmService.linkTask(input);
      const activities = await crmService.listActivities();
      set((s) => ({ taskLinks: [...s.taskLinks, link], activities }));
      return link;
    } catch (err) {
      showError(err, 'Failed to link task.');
      return null;
    }
  },

  unlinkTask: async (id) => {
    set((s) => ({ taskLinks: s.taskLinks.filter((t) => t.id !== id) }));
    try {
      await crmService.unlinkTask(id);
    } catch (err) {
      showError(err, 'Failed to unlink task.');
      void get().loadCrm();
    }
  },

  createSavedView: async (input) => {
    try {
      const view = await crmService.createSavedView(input);
      set((s) => ({ savedViews: [...s.savedViews, view], activeSavedViewId: view.id }));
      return view;
    } catch (err) {
      showError(err, 'Failed to save view.');
      return null;
    }
  },

  deleteSavedView: async (id) => {
    set((s) => ({
      savedViews: s.savedViews.filter((v) => v.id !== id),
      activeSavedViewId: s.activeSavedViewId === id ? null : s.activeSavedViewId,
    }));
    try {
      await crmService.deleteSavedView(id);
    } catch (err) {
      showError(err, 'Failed to delete saved view.');
      void get().loadCrm();
    }
  },

  exportLeads: async () => {
    try {
      await crmService.exportLeadsToCsv(get().contacts, get().companies);
    } catch (err) {
      showError(err, 'Failed to export leads.');
    }
  },

  // ---- selectors ----------------------------------------------------------
  getLeadById: (id) => (id ? get().leads.find((l) => l.id === id) : undefined),
  getContactById: (id) => (id ? get().contacts.find((c) => c.id === id) : undefined),
  getCompanyById: (id) => (id ? get().companies.find((c) => c.id === id) : undefined),
  getDealById: (id) => (id ? get().deals.find((d) => d.id === id) : undefined),

  selectLeadsByStage: () => crmService.selectLeadsByStage(get().leads),
  selectDealsByStage: () => crmService.selectDealsByStage(get().deals),
  selectDashboardKPIs: (tasksDue = 0) =>
    crmService.computeDashboardKPIs(get().leads, get().deals, tasksDue),

  selectActivitiesForLead: (leadId) =>
    get()
      .activities.filter((a) => a.leadId === leadId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),

  selectNotesForLead: (leadId) =>
    get()
      .notes.filter((n) => n.leadId === leadId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
}));

// Apply a saved view's filter set onto the current filters shape. This is a
// light projection: rules are mapped onto the filter fields the UI supports.
function applyViewToFilters(viewFilters: CRMFilterSet, current: CRMFilters): CRMFilters {
  const next: CRMFilters = {
    lead: { ...current.lead },
    deal: { ...current.deal },
    contact: { ...current.contact },
    company: { ...current.company },
    activity: { ...current.activity },
  };
  if (viewFilters.entity === 'lead') {
    for (const rule of viewFilters.rules) {
      if (rule.field === 'stage' && rule.operator === 'in' && Array.isArray(rule.value)) {
        next.lead.stage = rule.value[0] as CRMDealStage;
      } else if (rule.field === 'status' && rule.operator === 'eq') {
        next.lead.status = rule.value as CRMLeadStatus;
      } else if (rule.field === 'tags' && rule.operator === 'contains') {
        next.lead.tags = [String(rule.value)];
      } else if (rule.field === 'score' && rule.operator === 'gte') {
        const threshold = Number(rule.value);
        if (threshold >= 80) next.lead.scoreBand = 'high';
        else if (threshold >= 50) next.lead.scoreBand = 'med';
        else next.lead.scoreBand = 'low';
      }
    }
  } else if (viewFilters.entity === 'deal') {
    for (const rule of viewFilters.rules) {
      if (rule.field === 'stage' && rule.operator === 'in' && Array.isArray(rule.value)) {
        next.deal.stage = rule.value[0] as CRMDealStage;
      } else if (rule.field === 'ownerId' && rule.operator === 'eq') {
        next.deal.ownerId = String(rule.value);
      }
    }
  }
  return next;
}
