import { useMemo } from 'react';
import { Plus, Search } from 'lucide-react';
import { useCrmStore } from '../../../stores/crmStore';
import { TagChips } from '../components';
import { byNewestFirst, formatRelative, fullName } from '../components/format';

interface ContactListProps {
  onAddContact?: () => void;
}

export function ContactList({ onAddContact }: ContactListProps) {
  const {
    contacts,
    companies,
    activeContactId,
    setActiveContactId,
    filters,
    setContactFilters,
  } = useCrmStore();

  const filtered = useMemo(() => {
    const { search, companyId } = filters.contact;
    const lower = search?.trim().toLowerCase();
    return contacts
      .filter((c) => (companyId ? c.companyId === companyId : true))
      .filter((c) => {
        if (!lower) return true;
        const company = c.companyId ? companies.find((co) => co.id === c.companyId) : undefined;
        const haystack = [
          c.firstName,
          c.lastName,
          c.email ?? '',
          c.phone ?? '',
          c.jobTitle ?? '',
          company?.name ?? '',
          c.tags.join(' '),
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(lower);
      })
      .sort(byNewestFirst((c) => c.lastActivityAt));
  }, [contacts, companies, filters.contact]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="crm-list-search">
        <Search className="crm-list-search-icon" />
        <input className="ui-input"
          type="text"
          placeholder="Search contacts…"
          value={filters.contact.search ?? ''}
          onChange={(e) => setContactFilters({ search: e.target.value })}
        />
      </div>

      <div className="crm-list-section-label">Contacts · {filtered.length}</div>

      {filtered.length === 0 && (
        <div className="crm-list-empty">
          <p className="txt-xs subtle">No contacts match your search.</p>
        </div>
      )}

      {filtered.map((contact) => {
        const isActive = contact.id === activeContactId;
        const company = contact.companyId ? companies.find((c) => c.id === contact.companyId) : undefined;
        return (
          <button data-active={isActive}
            key={contact.id}
            type="button"
            className={"ui-list-row " + (`crm-list-item${isActive ? ' crm-list-item--active' : ''}`)}
            onClick={() => setActiveContactId(contact.id)}
          >
            <div className="crm-list-item-row">
              <span className="crm-list-item-title">{fullName(contact.firstName, contact.lastName)}</span>
              <span className="crm-list-item-sub">{formatRelative(contact.lastActivityAt)}</span>
            </div>
            <div className="crm-list-item-row">
              <span className="crm-list-item-sub">{contact.jobTitle ?? company?.name ?? '—'}</span>
            </div>
            {contact.tags.length > 0 && (
              <div className="crm-list-item-row">
                <TagChips tags={contact.tags} max={3} />
              </div>
            )}
          </button>
        );
      })}

      {onAddContact && (
        <button type="button" className="ui-button crm-btn crm-btn--ghost crm-btn--sm" onClick={onAddContact} style={{ marginTop: 6 }}>
          <Plus /> Add contact
        </button>
      )}
    </div>
  );
}
