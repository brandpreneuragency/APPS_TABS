import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { Download, FileInput, Plus, Trash2 } from 'lucide-react';
import { useCrmStore } from '../../../stores/crmStore';
import { useUIStore } from '../../../stores/uiStore';
import { CRMTabBar } from '../components';
import type { SettingsSectionId } from '../lists/SettingsNav';
import '../crm.css';

/**
 * Cross-panel settings-tab state. Panel 1 (CRMListPanel) renders <SettingsNav>
 * bound to this store so clicking a section there switches the active section
 * here in Panel 2 — without touching uiStore (owned by the Layout agent) and
 * without creating a new file (kept inside the page that owns the state).
 */
interface CrmSettingsTabState {
  tab: SettingsSectionId;
  setTab: (t: SettingsSectionId) => void;
}
// eslint-disable-next-line react-refresh/only-export-components -- settings-tab store co-located with its page (imported by CRMListPanel)
export const useCrmSettingsTab = create<CrmSettingsTabState>((set) => ({
  tab: 'leadFields',
  setTab: (tab) => set({ tab }),
}));

const SETTINGS_TABS: { id: SettingsSectionId; label: string }[] = [
  { id: 'leadFields', label: 'Lead Fields' },
  { id: 'stages', label: 'Stages' },
  { id: 'tags', label: 'Tags' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'duplicate', label: 'Duplicate Handling' },
  { id: 'export', label: 'Export' },
  { id: 'futureApi', label: 'Future API' },
];

const DEFAULT_LEAD_STATUSES = [
  'new',
  'contacted',
  'qualified',
  'proposal',
  'won',
  'lost',
  'spam',
];

/**
 * Panel 2 for the CRM Settings page. A tab bar (Lead Fields / Stages / Tags /
 * Notifications / Duplicate Handling / Export / Future API) switches between
 * read-mostly settings sections. Most controls are intentionally placeholders
 * marked for a future backend/VPS agent; the Export section wires the existing
 * crmStore.exportLeads action.
 */
export default function CRMSettingsPage() {
  const { isLoaded, loadCrm, leads, contacts, companies, pipelineStages, exportLeads } =
    useCrmStore();
  const { setActiveCRMPage, setActiveFormsPage } = useUIStore();
  const { tab, setTab } = useCrmSettingsTab();

  // Local tag management state — crmStore has no tag CRUD setter, so add/remove
  // here is UI-only for tags added in this session. A future agent can persist
  // tag changes via a tag CRUD on crmStore; entity-attached tags are read-only.
  const [extraTags, setExtraTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [matchByEmail, setMatchByEmail] = useState(true);

  useEffect(() => {
    if (!isLoaded) void loadCrm();
  }, [isLoaded, loadCrm]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    leads.forEach((l) => l.tags.forEach((t) => set.add(t)));
    contacts.forEach((c) => c.tags.forEach((t) => set.add(t)));
    companies.forEach((c) => c.tags.forEach((t) => set.add(t)));
    extraTags.forEach((t) => set.add(t));
    return Array.from(set).sort();
  }, [leads, contacts, companies, extraTags]);

  const handleAddTag = () => {
    const v = tagInput.trim();
    if (!v || allTags.includes(v)) {
      setTagInput('');
      return;
    }
    setExtraTags((prev) => [...prev, v]);
    setTagInput('');
  };

  const handleRemoveTag = (tag: string) => {
    setExtraTags((prev) => prev.filter((t) => t !== tag));
    // Removing tags already attached to entities would require per-entity
    // updates and is intentionally not performed here (no tag CRUD yet).
  };

  return (
    <div className="crm-page">
      <div className="ui-card crm-page-header">
        <div className="crm-page-header-main">
          <div className="crm-page-header-title">CRM Settings</div>
          <div className="crm-page-header-meta">
            <span className="crm-page-header-meta-item">Local-first · Future VPS API ready</span>
          </div>
        </div>
      </div>

      <CRMTabBar
        tabs={SETTINGS_TABS}
        active={tab}
        onChange={(id) => setTab(id as SettingsSectionId)}
      />

      <div className="ui-panel-body crm-page-body">
        {tab === 'leadFields' && (
          <div className="ui-card crm-card">
            <div className="crm-card-title">Default lead statuses</div>
            <div className="ui-card crm-settings-note">
              These statuses drive the lead status dropdown and map 1:1 to pipeline stages. The list
              is read-only for now — full field customization is a placeholder for a future agent.
            </div>
            <div className="crm-settings-list">
              {DEFAULT_LEAD_STATUSES.map((status) => (
                <div key={status} className="ui-list-row crm-settings-list-row">
                  <span className="crm-settings-list-row-title">{status}</span>
                  <span className="crm-settings-list-row-sub">default</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'stages' && (
          <div className="ui-card crm-card">
            <div className="crm-card-title">Pipeline stages</div>
            <div className="ui-card crm-settings-note">
              The 7 default pipeline stages used by the Kanban board. Reordering, renaming, and
              add/remove are placeholders for now.
            </div>
            <div className="crm-settings-list">
              {pipelineStages.map((stage) => (
                <div key={stage.id} className="ui-list-row crm-settings-list-row">
                  <span className="crm-settings-list-row-title">{stage.label}</span>
                  <span className="crm-settings-list-row-sub">
                    order {stage.order} · {stage.key}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'tags' && (
          <div className="ui-card crm-card">
            <div className="crm-card-title">Tags</div>
            <div className="ui-card crm-settings-note">
              Tags gathered from leads, contacts, and companies. Add/remove here is UI-only for
              tags added in this session (crmStore has no tag CRUD yet); a future agent can persist
              tag changes and strip tags from entities.
            </div>
            <div className="crm-list-search" style={{ marginBottom: 8 }}>
              <Plus className="crm-list-search-icon" />
              <input className="ui-input"
                type="text"
                placeholder="Add a tag…"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddTag();
                  }
                }}
              />
              <button
                type="button"
                className="ui-button crm-btn crm-btn--sm"
                onClick={handleAddTag}
                disabled={!tagInput.trim()}
              >
                Add
              </button>
            </div>
            <div className="crm-settings-list">
              {allTags.length === 0 && <div className="crm-muted-block">No tags in use yet.</div>}
              {allTags.map((tag) => {
                const removable = extraTags.includes(tag);
                return (
                  <div key={tag} className="ui-list-row crm-settings-list-row">
                    <span className="crm-settings-list-row-title">{tag}</span>
                    <button
                      type="button"
                      className="ui-button crm-btn crm-btn--ghost crm-btn--sm"
                      onClick={() => handleRemoveTag(tag)}
                      disabled={!removable}
                      title={
                        removable
                          ? 'Remove tag'
                          : 'Only tags added in this session can be removed here'
                      }
                    >
                      <Trash2 /> Remove
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {tab === 'notifications' && (
          <div className="ui-card crm-card">
            <div className="crm-card-title">Notifications</div>
            <div className="ui-card crm-settings-note">
              Notification delivery is a future-backend feature. The toggles below are placeholders
              and do not send anything yet.
            </div>
            <div className="crm-settings-list">
              <div className="ui-list-row crm-settings-list-row">
                <span className="crm-settings-list-row-title">Email on new lead</span>
                <ToggleSwitch />
              </div>
              <div className="ui-list-row crm-settings-list-row">
                <span className="crm-settings-list-row-title">Inline in-app notification on submission</span>
                <ToggleSwitch />
              </div>
              <div className="ui-list-row crm-settings-list-row">
                <span className="crm-settings-list-row-title">Daily digest of stale leads</span>
                <ToggleSwitch />
              </div>
            </div>
          </div>
        )}

        {tab === 'duplicate' && (
          <div className="ui-card crm-card">
            <div className="crm-card-title">Duplicate handling</div>
            <div className="ui-card crm-settings-note">
              Submissions are matched to existing contacts and leads by email. When a match is
              found, the submission is attached as an activity and lastActivityAt is bumped — a
              duplicate contact is never created. When no match is found, a new Contact (+ Company
              if the name is new) and Lead are created. This logic lives in
              submissionService.resolveDuplicate.
            </div>
            <div className="crm-settings-list">
              <div className="ui-list-row crm-settings-list-row">
                <span className="crm-settings-list-row-title">Match by email</span>
                <ToggleSwitch on={matchByEmail} onClick={() => setMatchByEmail((v) => !v)} />
              </div>
            </div>
            <div className="ui-card crm-settings-note">
              The future backend will perform server-side duplicate matching for public submissions
              (see the Future API tab).
            </div>
          </div>
        )}

        {tab === 'export' && (
          <div className="ui-card crm-card">
            <div className="crm-card-title">Export</div>
            <div className="ui-card crm-settings-note">
              Export all leads (with contact + company fields) to a CSV file. Submission exports
              live in Forms Settings.
            </div>
            <div className="crm-dashboard-quick-actions">
              <button
                type="button"
                className="ui-button crm-btn crm-btn--sm ui-button--primary crm-btn--primary"
                onClick={() => void exportLeads()}
              >
                <Download /> Export leads to CSV
              </button>
              <button
                type="button"
                className="ui-button crm-btn crm-btn--sm"
                onClick={() => { setActiveCRMPage('forms'); setActiveFormsPage('settings'); }}
              >
                <FileInput /> Open Forms Settings
              </button>
            </div>
          </div>
        )}

        {tab === 'futureApi' && (
          <div className="ui-card crm-card">
            <div className="crm-card-title">Future VPS / Public API</div>
            <div className="ui-card crm-settings-note">
              CRM and Forms are local-first today: data lives in IndexedDB via Dexie and is accessed
              only through crmService / formsService / submissionService / embedService. Those
              services are the swap point for a future VPS API. The future backend will provide:
              public embed rendering, public submission ingestion, allowed-domain enforcement, CORS
              policy, rate limiting, spam protection, file upload storage, webhook delivery, email
              notifications, and server-side duplicate matching. Embed snippets are generated now,
              but production lead capture requires this public endpoint — no network calls are made
              from the app today.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Visual toggle switch reusing .crm-toggle-switch (off by default; disabled when no onClick). */
function ToggleSwitch({ on = false, onClick }: { on?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      className={`crm-toggle-switch${on ? ' crm-toggle-switch--on' : ''}`}
      onClick={onClick}
      disabled={!onClick}
      aria-pressed={on}
    />
  );
}
