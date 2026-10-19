import { useState } from 'react';
import { Folder, FolderGit2, Search, Settings2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { GithubRepo } from '../../services/github/types';

interface GithubRepositoryNavigationProps {
  repos: GithubRepo[];
  openRepoIds: string[];
  activeRepoId: string | null;
  complete: boolean;
  busy: boolean;
  managing: boolean;
  login: string;
  onOpen: (repoId: string) => void;
  onClose: (repo: GithubRepo) => void;
  onManage: () => void;
}

/** Repository scope navigation; file and branch content belong to the left panel. */
export function GithubRepositoryNavigation({
  repos, openRepoIds, activeRepoId, complete, busy, managing, login,
  onOpen, onClose, onManage,
}: GithubRepositoryNavigationProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const openRepos = openRepoIds.flatMap((id) => {
    const repo = repos.find((item) => item.id === id);
    return repo ? [repo] : [];
  });
  const filteredRepos = repos.filter((repo) => !normalizedQuery
    || `${repo.ownerLogin}/${repo.name}`.toLocaleLowerCase().includes(normalizedQuery));
  const availableRepos = filteredRepos.filter((repo) => !openRepoIds.includes(repo.id));

  return (
    <div className="github-repository-navigation">
      <header className="ui-toolbar github-navigation-heading">
        <FolderGit2 aria-hidden="true" />
        <h2>{t('github.repositories')}</h2>
        <button type="button" className="ui-icon-button github-icon-button" title={t('github.manageRepositories')}
          aria-label={t('github.manageRepositories')} disabled={managing} onClick={onManage}>
          <Settings2 aria-hidden="true" />
        </button>
      </header>
      <label className="github-repo-search">
        <Search aria-hidden="true" />
        <input className="ui-input" type="search" aria-label={t('github.repoSearch')} placeholder={t('github.repoSearchPlaceholder')}
          value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
      </label>
      <div className="ui-panel-body github-repository-navigation-scroll">
        {openRepos.length > 0 && (
          <div className="github-open-repositories" role="tablist" aria-orientation="vertical" aria-label={t('github.repoTabs')}
            onKeyDown={(event) => {
              const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
              const index = tabs.indexOf(event.target as HTMLButtonElement);
              if (index < 0 || busy) return;
              const next = event.key === 'ArrowDown' ? (index + 1) % tabs.length
                : event.key === 'ArrowUp' ? (index - 1 + tabs.length) % tabs.length
                  : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
              if (next === null) return;
              event.preventDefault();
              tabs[next]?.focus();
              tabs[next]?.click();
            }}>
            {openRepos.map((repo) => (
              <div className="github-repository-row" key={repo.id} role="presentation">
                <button type="button" role="tab" className="ui-list-row github-repo-option" aria-label={repo.name}
                  aria-selected={activeRepoId === repo.id} tabIndex={activeRepoId === repo.id ? 0 : -1}
                  disabled={busy} title={`${repo.ownerLogin}/${repo.name}`} onClick={() => onOpen(repo.id)}>
                  <Folder aria-hidden="true" />
                  <span className="github-repo-option-name">{repo.name}</span>
                  {repo.private && <span className="github-private-badge">{t('github.private')}</span>}
                </button>
                <button type="button" className="ui-icon-button github-tab-close" disabled={busy}
                  aria-label={t('github.closeRepoTab', { name: repo.name })}
                  title={t('github.closeRepoTab', { name: repo.name })} onClick={() => onClose(repo)}>
                  <X aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="github-repo-search-results" role="group" aria-label={t('github.repoSearch')}>
          {availableRepos.map((repo) => (
            <button type="button" key={repo.id} className="ui-list-row github-repo-option" disabled={busy}
              title={`${repo.ownerLogin}/${repo.name}`} onClick={() => onOpen(repo.id)}>
              <Folder aria-hidden="true" />
              <span className="github-repo-option-name">{repo.name}</span>
              {repo.private && <span className="github-private-badge">{t('github.private')}</span>}
            </button>
          ))}
          {filteredRepos.length === 0 && (
            <p className="github-inline-status">{t(repos.length ? 'github.noRepoMatches' : 'github.noRepos')}</p>
          )}
          {!complete && <p className="github-inline-warning" role="status">{t('github.incompleteRepos')}</p>}
        </div>
      </div>
      <footer className="github-connection-status" role="status">
        <span className="github-status-dot" aria-hidden="true" />
        <span className="github-connected-login" title={t('github.connectedAs', { login })}>
          {busy ? t('github.statusChecking') : login}
        </span>
      </footer>
    </div>
  );
}
