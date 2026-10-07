import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { TabsDB } from '../../services/db';
import { createGithubService } from '../../services/github/service';
import { decodeBase64 } from '../../services/github/binary';
import { emptyRefAdvertisement, pktLine, receivePackOk } from '../../services/github/gitPack';
import { createMemoryNativeSession } from '../../services/github/nativeSession';
import { createFixtureTransport, jsonResponse } from '../../services/github/testing/fixtureTransport';
import { createMemorySecureStore } from '../../services/github/testing/memorySecureStore';
import type { GithubClock, GithubTransportRequest } from '../../services/github/types';
import { createGithubStore } from '../../stores/githubStore';
import { useChatStore } from '../../stores/chatStore';
import { GithubAssistantNotice, GithubWorkspace } from './GithubWorkspace';

const runtime = vi.hoisted(() => ({ isTauri: true }));
vi.mock('../../services/runtime', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../services/runtime')>(),
  isTauriRuntime: () => runtime.isTauri,
}));

const databases: TabsDB[] = [];
const aiTestThreads: string[] = [];

function personalRepo(id: number, name: string, isPrivate: boolean) {
  return {
    id,
    name,
    private: isPrivate,
    default_branch: 'main',
    description: null,
    owner: { id: 7, login: 'octocat', type: 'User' },
    html_url: `https://github.com/octocat/${name}`,
  };
}

function fileBody(path: string, text: string) {
  const name = path.split('/').at(-1) ?? path;
  return { type: 'file', encoding: 'base64', content: btoa(text), size: text.length, sha: `blob-${name}`, path, name };
}

interface GithubFixtureState {
  branchHeads: Map<string, string>;
  emptyBranches: Set<string>;
  remoteFiles: Map<string, string>;
  protectedBranches: Set<string>;
  commits: Map<string, { treeSha: string; message: string }>;
  createdRepos: Array<Omit<ReturnType<typeof personalRepo>, 'description'> & { description: string | null }>;
  deletedRepoIds: Set<string>;
  grantedScopes: string[];
  deviceFlowScope: string;
  receivePackResponse: 'ok' | 'malformed' | 'race' | 'protected';
  nextRepoId: number;
  nextWrite: number;
}

function fixtureResponse(request: GithubTransportRequest, state: GithubFixtureState) {
  const url = new URL(request.url);
  const path = url.pathname;
  const repoName = path.startsWith('/repos/') ? path.split('/')[3] ?? '' : path.includes('.git/') ? path.split('/')[2]?.replace(/\.git$/, '') ?? '' : '';
  const branchKey = (branch: string) => `${repoName}:${decodeURIComponent(branch)}`;
  const writeNumber = () => ++state.nextWrite;
  if (path === '/login/device/code') {
    state.deviceFlowScope = new URLSearchParams(request.body ?? '').get('scope') ?? 'repo';
    return jsonResponse(200, {
      device_code: 'fixture-device-code',
      user_code: 'WDJB-MJHT',
      verification_uri: 'https://github.com/login/device',
      expires_in: 900,
      interval: 5,
    });
  }
  if (path === '/login/oauth/access_token') {
    state.grantedScopes = state.deviceFlowScope.split(/\s+/).filter(Boolean);
    return jsonResponse(200, { access_token: 'fixture-access-token', token_type: 'bearer', scope: state.grantedScopes.join(' ') });
  }
  if (path === '/user') return jsonResponse(200, { id: 7, login: 'octocat', type: 'User' }, { 'x-oauth-scopes': state.grantedScopes.join(', ') });
  if (path === '/user/repos' && request.method === 'POST') {
    const body = JSON.parse(request.body ?? '{}') as { name?: string; description?: string; private?: boolean; auto_init?: boolean };
    if (!body.name || typeof body.private !== 'boolean' || typeof body.auto_init !== 'boolean') return jsonResponse(422, { message: 'invalid fixture repository create' });
    const repo = { ...personalRepo(state.nextRepoId++, body.name, body.private), description: body.description ?? null };
    state.createdRepos.push(repo);
    state.emptyBranches.add(`${repo.name}:main`);
    return jsonResponse(201, repo);
  }
  if (path === '/user/repos') return jsonResponse(200, [
    personalRepo(42, 'notes', true),
    personalRepo(43, 'other', false),
    ...state.createdRepos,
  ].filter((repo) => !state.deletedRepoIds.has(String(repo.id))));
  if (path.startsWith('/repositories/')) {
    const id = path.split('/').at(-1) ?? '';
    if (state.deletedRepoIds.has(id)) return jsonResponse(404, { message: 'Not Found' });
    const repo = id === '42' ? personalRepo(42, 'notes', true)
      : id === '43' ? personalRepo(43, 'other', false)
        : state.createdRepos.find((candidate) => String(candidate.id) === id);
    return repo ? jsonResponse(200, { ...repo, permissions: { admin: true } }) : jsonResponse(404, { message: 'Not Found' });
  }
  if (path === '/gitignore/templates') return jsonResponse(200, ['Node', 'Rust']);
  if (path === '/licenses') return jsonResponse(200, [{ key: 'mit', name: 'MIT License' }, { key: 'apache-2.0', name: 'Apache License 2.0' }]);
  if (path.endsWith('.git/info/refs') && url.searchParams.get('service') === 'git-receive-pack') {
    return { status: 200, headers: {}, bodyText: emptyRefAdvertisement() };
  }
  if (path.endsWith('.git/git-receive-pack') && request.method === 'POST') {
    const raw = atob(request.body ?? '');
    const packetLength = Number.parseInt(raw.slice(0, 4), 16);
    const command = Number.isFinite(packetLength) ? raw.slice(4, packetLength) : '';
    const update = command.match(/^0{40} ([0-9a-f]{40}) refs\/heads\/([^\0]+)/);
    if (!update || command.includes(' force') || command.includes('+refs/')) return { status: 400, headers: {}, bodyText: 'invalid receive-pack command' };
    const [, newSha, branch] = update;
    if (state.receivePackResponse === 'malformed') return { status: 200, headers: {}, bodyText: 'malformed receive-pack response' };
    if (state.receivePackResponse === 'race') {
      state.branchHeads.set(`${repoName}:${branch}`, 'e'.repeat(40));
      state.emptyBranches.delete(`${repoName}:${branch}`);
      return { status: 200, headers: {}, bodyText: `${pktLine('unpack ok\n')}${pktLine(`ng refs/heads/${branch} stale info\n`)}0000` };
    }
    if (state.receivePackResponse === 'protected') {
      return { status: 200, headers: {}, bodyText: `${pktLine('unpack ok\n')}${pktLine(`ng refs/heads/${branch} protected branch hook declined\n`)}0000` };
    }
    state.branchHeads.set(`${repoName}:${branch}`, newSha);
    state.emptyBranches.delete(`${repoName}:${branch}`);
    return { status: 200, headers: {}, bodyText: receivePackOk(branch) };
  }
  if (request.method === 'DELETE' && path.startsWith('/repos/')) {
    const name = path.split('/')[3] ?? '';
    const repo = name === 'notes' ? '42' : name === 'other' ? '43' : state.createdRepos.find((candidate) => candidate.name === name)?.id;
    if (repo === undefined) return jsonResponse(404, { message: 'Not Found' });
    state.deletedRepoIds.add(String(repo));
    return jsonResponse(204, null);
  }
  if (path.endsWith('/branches')) return jsonResponse(200, [...state.branchHeads.entries()]
    .filter(([key]) => key.startsWith(`${repoName}:`))
    .map(([key, sha]) => {
      const name = key.slice(repoName.length + 1);
      return { name, commit: { sha }, protected: state.protectedBranches.has(key) };
    }));
  if (path.includes('/branches/')) {
    const branch = decodeURIComponent(path.slice(path.indexOf('/branches/') + '/branches/'.length));
    if (state.emptyBranches.has(branchKey(branch))) return jsonResponse(409, { message: 'Git Repository is empty.' });
    const sha = state.branchHeads.get(branchKey(branch));
    return sha ? jsonResponse(200, { name: branch, commit: { sha }, protected: state.protectedBranches.has(branchKey(branch)) })
      : jsonResponse(404, { message: 'fixture branch not found' });
  }
  if (path.endsWith('/git/ref/heads/main') || path.includes('/git/ref/heads/')) {
    const branch = decodeURIComponent(path.slice(path.indexOf('/git/ref/heads/') + '/git/ref/heads/'.length));
    const sha = state.branchHeads.get(branchKey(branch));
    return sha ? jsonResponse(200, { ref: `refs/heads/${branch}`, object: { sha } }) : jsonResponse(404, { message: 'fixture ref not found' });
  }
  if (request.method === 'POST' && path.endsWith('/git/refs')) {
    const body = JSON.parse(request.body ?? '{}') as { ref?: string; sha?: string };
    const branch = (body.ref ?? '').replace(/^refs\/heads\//, '');
    if (!branch || !body.sha) return jsonResponse(422, { message: 'invalid fixture ref' });
    state.branchHeads.set(branchKey(branch), body.sha);
    return jsonResponse(201, { ref: body.ref, object: { sha: body.sha } });
  }
  if (request.method === 'PATCH' && path.includes('/git/refs/heads/')) {
    const branch = decodeURIComponent(path.slice(path.indexOf('/git/refs/heads/') + '/git/refs/heads/'.length));
    const body = JSON.parse(request.body ?? '{}') as { sha?: string };
    if (!body.sha) return jsonResponse(422, { message: 'invalid fixture update' });
    state.branchHeads.set(branchKey(branch), body.sha);
    return jsonResponse(200, { object: { sha: body.sha } });
  }
  if (request.method === 'POST' && path.endsWith('/git/blobs')) return jsonResponse(201, { sha: `fixture-blob-${writeNumber()}` });
  if (request.method === 'POST' && path.endsWith('/git/trees')) return jsonResponse(201, { sha: `fixture-tree-${writeNumber()}` });
  if (request.method === 'POST' && path.endsWith('/git/commits')) {
    const body = JSON.parse(request.body ?? '{}') as { tree?: string; message?: string };
    const sha = `fixture-commit-${writeNumber()}`;
    state.commits.set(sha, { treeSha: body.tree ?? 'fixture-tree', message: body.message ?? '' });
    return jsonResponse(201, { sha });
  }
  if (path.includes('/git/commits/')) {
    const sha = path.slice(path.indexOf('/git/commits/') + '/git/commits/'.length);
    const commit = state.commits.get(sha) ?? { treeSha: 'tree-main', message: 'Fixture commit' };
    return jsonResponse(200, { sha, tree: { sha: commit.treeSha }, parents: [] });
  }
  if (path.includes('/git/trees/')) return jsonResponse(200, { tree: repoName === 'notes' ? [
    { path: 'README.md', mode: '100644', type: 'blob', sha: 'blob-README.md' },
    { path: 'docs/guide.md', mode: '100644', type: 'blob', sha: 'blob-guide' },
  ] : [{ path: 'README.md', mode: '100644', type: 'blob', sha: 'blob-README.md' }], truncated: false });
  if (path.endsWith('/commits')) return jsonResponse(200, [{
    sha: 'main-sha',
    commit: { message: 'Fixture history entry', author: { date: '2026-10-05T00:00:00Z' } },
  }]);
  if (path.includes('/commits/')) {
    const sha = path.slice(path.lastIndexOf('/commits/') + '/commits/'.length);
    return jsonResponse(200, { sha, commit: { message: 'Fixture history entry' }, files: [{ filename: 'README.md', status: 'modified' }] });
  }
  if (path.includes('/contents')) {
    const marker = path.indexOf('/contents');
    const repoName = path.split('/')[3];
    const innerPath = decodeURIComponent(path.slice(marker + '/contents'.length).replace(/^\/+/, ''));
    const ref = url.searchParams.get('ref') ?? '';
    if (!innerPath && state.emptyBranches.has(`${repoName}:${ref}`)) return jsonResponse(200, []);
    if (!innerPath && repoName === 'notes') return jsonResponse(200, [
      { type: 'file', name: 'README.md', path: 'README.md', sha: 'blob-readme', size: 9 },
      { type: 'dir', name: 'docs', path: 'docs', sha: 'tree-docs', size: 0 },
    ]);
    if (!innerPath && repoName === 'other') return jsonResponse(200, [
      { type: 'file', name: 'README.md', path: 'README.md', sha: 'blob-other', size: 9 },
    ]);
    if (innerPath === 'docs' && repoName === 'notes') return jsonResponse(200, [
      { type: 'file', name: 'guide.md', path: 'docs/guide.md', sha: 'blob-guide', size: 12 },
    ]);
    if (innerPath === 'README.md' && repoName === 'notes') return jsonResponse(200, fileBody('README.md', state.remoteFiles.get('notes:README.md') ?? '# remote'));
    if (innerPath === 'README.md' && repoName === 'other') return jsonResponse(200, fileBody('README.md', state.remoteFiles.get('other:README.md') ?? '# other'));
    if (innerPath === 'docs/guide.md') return jsonResponse(200, fileBody('docs/guide.md', state.remoteFiles.get('notes:docs/guide.md') ?? '# guide text'));
  }
  if (path.includes('/git/blobs/')) {
    const sha = path.slice(path.lastIndexOf('/git/blobs/') + '/git/blobs/'.length);
    const content = sha === 'blob-guide' ? state.remoteFiles.get('notes:docs/guide.md') ?? '# guide text'
      : state.remoteFiles.get(`${repoName}:README.md`) ?? '# remote';
    return jsonResponse(200, { sha, content: btoa(content), encoding: 'base64', size: content.length });
  }
  return jsonResponse(404, { message: 'fixture target not found' });
}

function fixtureClock(): GithubClock {
  let now = 1_000_000;
  return {
    now: () => now,
    async sleep(ms, signal) {
      if (signal.aborted) throw new Error('Fixture operation cancelled');
      now += ms;
    },
  };
}

async function createIsolatedStore(
  name = `GithubWorkspace-${crypto.randomUUID()}`,
  nativeSession?: ReturnType<typeof createMemoryNativeSession>,
) {
  const database = new TabsDB(name);
  databases.push(database);
  await database.open();
  const requests: GithubTransportRequest[] = [];
  const fixture: GithubFixtureState = {
    branchHeads: new Map([['notes:main', 'main-sha'], ['notes:dev', 'dev-sha'], ['other:main', 'main-sha']]),
    emptyBranches: new Set(),
    remoteFiles: new Map([['notes:README.md', '# remote'], ['notes:docs/guide.md', '# guide text'], ['other:README.md', '# other']]),
    protectedBranches: new Set(),
    commits: new Map(),
    createdRepos: [],
    deletedRepoIds: new Set(),
    grantedScopes: ['repo'],
    deviceFlowScope: 'repo',
    receivePackResponse: 'ok',
    nextRepoId: 44,
    nextWrite: 0,
  };
  const secureStore = createMemorySecureStore();
  const transport = createFixtureTransport((request) => {
    requests.push(request);
    return fixtureResponse(request, fixture);
  });
  const service = createGithubService({
    database,
    secureStore,
    transport,
    clock: fixtureClock(),
    ...(nativeSession ? { nativeSession } : {}),
  });
  return { database, name, requests, secureStore, transport, fixture, nativeSession, service, store: createGithubStore(service) };
}

async function connectAndOpenNotes(context: Awaited<ReturnType<typeof createIsolatedStore>>) {
  const user = userEvent.setup();
  const view = render(<GithubWorkspace store={context.store} />);
  const clientId = await screen.findByRole('textbox', { name: 'GitHub OAuth App Client ID' });
  await user.type(clientId, 'Iv1.fixture1234');
  await user.click(screen.getByRole('button', { name: 'Save Client ID' }));
  await user.click(await screen.findByRole('button', { name: 'Connect GitHub' }));
  await screen.findByLabelText('One-time code');
  await user.click(screen.getByRole('button', { name: 'I entered the code' }));
  const repository = await screen.findByRole('button', { name: /^notes/ });
  await user.click(repository);
  const branchPicker = await screen.findByRole('combobox', { name: 'Branch' });
  await waitFor(() => expect(branchPicker).toBeEnabled());
  await user.click(await screen.findByRole('button', { name: 'Open README.md' }));
  await screen.findByRole('textbox', { name: 'Source for README.md' });
  return { user, view };
}

async function stageEmptyRepositoryFiles(
  context: Awaited<ReturnType<typeof createIsolatedStore>>,
  user: ReturnType<typeof userEvent.setup>,
) {
  context.fixture.emptyBranches.add('notes:main');
  context.fixture.branchHeads.delete('notes:main');
  context.fixture.branchHeads.delete('notes:dev');
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(context.store.getState().remote?.empty).toBe(true));

  await user.click(screen.getByText('Local file operations', { selector: 'summary' }));
  await user.click(screen.getByText('New file', { selector: 'summary' }));
  const form = screen.getByRole('button', { name: 'Add local draft' }).closest('form');
  expect(form).not.toBeNull();
  const path = within(form as HTMLFormElement).getByRole('textbox', { name: 'Repository path' });
  const text = within(form as HTMLFormElement).getByRole('textbox', { name: 'Initial text' });

  await user.type(path, 'first.txt');
  await user.type(text, 'first fixture file');
  await user.click(within(form as HTMLFormElement).getByRole('button', { name: 'Add local draft' }));
  await waitFor(() => expect(context.store.getState().drafts.some((draft) => draft.path === 'first.txt')).toBe(true));
  await user.type(path, 'second.txt');
  await user.type(text, 'second fixture file');
  await user.click(within(form as HTMLFormElement).getByRole('button', { name: 'Add local draft' }));
  await waitFor(() => expect(context.store.getState().drafts.filter((draft) => draft.path.endsWith('.txt'))).toHaveLength(2));
  const changesTab = screen.getByRole('tab', { name: /Changes/ });
  await user.click(changesTab);
  await waitFor(() => expect(changesTab).toHaveAttribute('aria-selected', 'true'));
  await user.type(await screen.findByRole('textbox', { name: 'Commit message' }), 'Create fixture initial commit');
}

function receivePackRequests(context: Awaited<ReturnType<typeof createIsolatedStore>>) {
  return context.requests.filter((request) => request.url.endsWith('.git/git-receive-pack'));
}

function contentsWrites(context: Awaited<ReturnType<typeof createIsolatedStore>>) {
  return context.requests.filter((request) => request.url.includes('/contents/')
    && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method));
}

beforeEach(async () => {
  runtime.isTauri = true;
  await i18n.changeLanguage('en');
});

afterEach(async () => {
  cleanup();
  for (const threadId of aiTestThreads.splice(0)) await useChatStore.getState().deleteThread(threadId);
  for (const database of databases.splice(0)) {
    database.close();
    await database.delete();
  }
});

describe('GitHub Phase 1 rendered workspace', () => {
  it('configures through Device Flow, opens and edits fixture files, switches repos, and restores the persisted draft', async () => {
    const user = userEvent.setup();
    const nativeSession = createMemoryNativeSession({ user: { id: '7', login: 'octocat' } });
    const openDeviceLogin = vi.spyOn(nativeSession, 'openDeviceLogin');
    const context = await createIsolatedStore(undefined, nativeSession);
    const view = render(<GithubWorkspace store={context.store} />);

    const clientId = await screen.findByRole('textbox', { name: 'GitHub OAuth App Client ID' });
    await user.type(clientId, 'Iv1.fixture1234');
    await user.click(screen.getByRole('button', { name: 'Save Client ID' }));
    await user.click(await screen.findByRole('button', { name: 'Connect GitHub' }));
    expect(await screen.findByLabelText('One-time code')).toHaveTextContent('WDJB-MJHT');
    const openDeviceLoginButton = screen.getByRole('button', { name: 'Open GitHub device sign-in' });
    expect(openDeviceLoginButton).not.toHaveAttribute('href');
    expect(openDeviceLoginButton).not.toHaveAttribute('target');
    await user.click(openDeviceLoginButton);
    expect(openDeviceLogin).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'I entered the code' }));

    const search = await screen.findByRole('searchbox', { name: 'Search personal repositories' });
    await user.type(search, 'notes');
    await user.click(await screen.findByRole('button', { name: /^notes/ }));
    const branchPicker = await screen.findByRole('combobox', { name: 'Branch' });
    await waitFor(() => expect(branchPicker).toBeEnabled());
    expect(await screen.findByRole('option', { name: 'dev' })).toBeInTheDocument();
    await user.selectOptions(branchPicker, 'dev');
    await waitFor(() => expect(branchPicker).toHaveValue('dev'));
    const treeFile = await screen.findByRole('button', { name: 'Open README.md' });
    await user.click(treeFile);
    const editor = await screen.findByRole('textbox', { name: 'Source for README.md' });
    expect(editor).toHaveValue('# remote');
    expect(screen.getAllByText('Private')).toHaveLength(2);

    await user.clear(editor);
    await user.type(editor, '# locally saved draft');
    await user.click(screen.getByRole('button', { name: 'Save Draft locally' }));
    expect(await screen.findAllByText('Local draft saved')).not.toHaveLength(0);

    const resizeHandle = screen.getByRole('separator', { name: 'Resize repository panel' });
    resizeHandle.focus();
    fireEvent.keyDown(resizeHandle, { key: 'ArrowRight' });
    await waitFor(async () => {
      const rows = await context.database.githubWorkspaces.toArray();
      expect(rows.find((row) => row.repoId === '42' && row.ref === 'dev')?.panel.navWidthPx).toBe(256);
    });

    await user.clear(search);
    await user.type(search, 'other');
    await user.click(await screen.findByRole('button', { name: 'other' }));
    await user.click(screen.getByRole('tab', { name: 'notes' }));
    const returnedEditor = await screen.findByRole('textbox', { name: 'Source for README.md' });
    await waitFor(() => expect(returnedEditor).toHaveValue('# locally saved draft'));

    view.unmount();
    context.database.close();
    const previousDatabase = databases.indexOf(context.database);
    if (previousDatabase !== -1) databases.splice(previousDatabase, 1);
    const reopenedDatabase = new TabsDB(context.name);
    databases.push(reopenedDatabase);
    await reopenedDatabase.open();
    const reopenedService = createGithubService({
      database: reopenedDatabase,
      secureStore: context.secureStore,
      transport: context.transport,
      clock: fixtureClock(),
      ...(context.nativeSession ? { nativeSession: context.nativeSession } : {}),
    });
    const reopenedStore = createGithubStore(reopenedService);
    render(<GithubWorkspace store={reopenedStore} />);

    const restoredEditor = await screen.findByRole('textbox', { name: 'Source for README.md' });
    await waitFor(() => expect(restoredEditor).toHaveValue('# locally saved draft'));
    expect(screen.getByRole('tab', { name: 'notes' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'README.md' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('combobox', { name: 'Branch' })).toHaveValue('dev');
    await waitFor(() => expect(reopenedStore.getState().branchWorkspace?.panel.navWidthPx).toBe(256));
    expect(await reopenedDatabase.githubDrafts.count()).toBe(1);

    const requestCount = context.requests.length;
    await user.click(screen.getByRole('button', { name: 'Close local tab for other' }));
    await waitFor(() => expect(screen.queryByRole('tab', { name: 'other' })).not.toBeInTheDocument());
    expect(context.requests).toHaveLength(requestCount);
    expect(await reopenedDatabase.githubDrafts.count()).toBe(1);
  });

  it('requires exact-target confirmation before one atomic commit is sent to the fixture', async () => {
    const context = await createIsolatedStore();
    const { user } = await connectAndOpenNotes(context);

    await user.click(screen.getByText('Local file operations', { selector: 'summary' }));
    await user.click(screen.getByText('New file', { selector: 'summary' }));
    const newFileForm = screen.getByRole('button', { name: 'Add local draft' }).closest('form');
    expect(newFileForm).not.toBeNull();
    await user.type(within(newFileForm as HTMLFormElement).getByRole('textbox', { name: 'Repository path' }), 'docs/one.md');
    await user.type(within(newFileForm as HTMLFormElement).getByRole('textbox', { name: 'Initial text' }), '# fixture content');
    await user.click(within(newFileForm as HTMLFormElement).getByRole('button', { name: 'Add local draft' }));
    await waitFor(() => expect(context.store.getState().drafts).toHaveLength(1));

    const changesTab = screen.getByRole('tab', { name: /Changes/ });
    await user.click(changesTab);
    await waitFor(() => expect(changesTab).toHaveAttribute('aria-selected', 'true'));
    const draftCheckbox = screen.getByRole('checkbox', { name: /docs\/one\.md/ });
    expect(draftCheckbox).toBeChecked();
    await user.type(screen.getByRole('textbox', { name: 'Commit message' }), 'Add fixture file');
    const createCommit = screen.getByRole('button', { name: 'Create commit and send to octocat/notes @ main' });
    await user.click(createCommit);

    const dialog = screen.getByRole('dialog', { name: 'Review the exact GitHub write' });
    expect(within(dialog).getByText('octocat/notes @ main')).toBeInTheDocument();
    expect(within(dialog).getByText('docs/one.md')).toBeInTheDocument();
    expect(within(dialog).getByText(/TABS-Commit-Id:/)).toBeInTheDocument();
    const repoWrites = () => context.requests.filter((request) => request.url.includes('/repos/octocat/notes') && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method));
    expect(repoWrites()).toHaveLength(0);

    await user.click(within(dialog).getByRole('button', { name: 'Confirm and send to octocat/notes @ main' }));
    await waitFor(() => expect(context.store.getState().commitResult?.status).toBe('sent'));
    expect(repoWrites().map((request) => request.method)).toEqual(['POST', 'POST', 'POST', 'PATCH']);
    expect(context.fixture.branchHeads.get('notes:main')).toMatch(/^fixture-commit-/);
    await waitFor(() => expect(context.store.getState().drafts).toHaveLength(0));
    expect(screen.getAllByText(/Commit sent/).length).toBeGreaterThan(0);
  });

  it('sends one confirmed multi-file first commit through the fixture smart-HTTP receive-pack path', async () => {
    const context = await createIsolatedStore();
    const { user } = await connectAndOpenNotes(context);
    await stageEmptyRepositoryFiles(context, user);

    await user.click(screen.getByRole('button', { name: 'Create commit and send to octocat/notes @ main' }));
    const dialog = await screen.findByRole('dialog', { name: 'Review the exact GitHub write' });
    expect(within(dialog).getByText('octocat/notes @ main')).toBeInTheDocument();
    expect(receivePackRequests(context)).toHaveLength(0);
    expect(contentsWrites(context)).toHaveLength(0);

    await user.click(within(dialog).getByRole('button', { name: 'Confirm and send to octocat/notes @ main' }));
    await waitFor(() => expect(context.store.getState().commitResult).toMatchObject({ status: 'sent', protocol: 'receive_pack' }));

    const [request] = receivePackRequests(context);
    expect(receivePackRequests(context)).toHaveLength(1);
    expect(request).toMatchObject({
      method: 'POST',
      bodyEncoding: 'base64',
      auth: 'bearer',
      headers: expect.objectContaining({
        'Content-Type': 'application/x-git-receive-pack-request',
        Accept: 'application/x-git-receive-pack-result',
      }),
    });
    const packet = decodeBase64(request.body ?? '');
    const packHeaderIndex = packet.findIndex((_, index) => packet[index] === 0x50
      && packet[index + 1] === 0x41 && packet[index + 2] === 0x43 && packet[index + 3] === 0x4b);
    expect(packHeaderIndex).toBeGreaterThan(-1);
    expect(context.fixture.branchHeads.get('notes:main')).toMatch(/^[a-f0-9]{40}$/);
    expect(contentsWrites(context)).toHaveLength(0);
    expect(context.requests.filter((item) => item.url.includes('/api.github.com/repos/octocat/notes')
      && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(item.method))).toHaveLength(0);
    await waitFor(() => expect(context.store.getState().drafts).toHaveLength(0));
  });

  it.each(['malformed', 'race', 'protected'] as const)(
    'does not retry or fall back to Contents writes after a %s receive-pack response',
    async (response) => {
      const context = await createIsolatedStore();
      const { user } = await connectAndOpenNotes(context);
      await stageEmptyRepositoryFiles(context, user);
      context.fixture.receivePackResponse = response;

      await user.click(screen.getByRole('button', { name: 'Create commit and send to octocat/notes @ main' }));
      const dialog = await screen.findByRole('dialog', { name: 'Review the exact GitHub write' });
      await user.click(within(dialog).getByRole('button', { name: 'Confirm and send to octocat/notes @ main' }));
      await waitFor(() => expect(context.store.getState().commitResult).not.toBeNull());

      expect(context.store.getState().commitResult?.status).not.toBe('sent');
      expect(receivePackRequests(context)).toHaveLength(1);
      expect(contentsWrites(context)).toHaveLength(0);
      expect(context.requests.filter((item) => item.url.includes('/api.github.com/repos/octocat/notes')
        && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(item.method))).toHaveLength(0);
      expect(context.store.getState().drafts.filter((draft) => draft.path.endsWith('.txt'))).toHaveLength(2);
    },
  );

  it('shows private-by-default repository options and confirms the exact create target without selecting it', async () => {
    const context = await createIsolatedStore();
    const { user } = await connectAndOpenNotes(context);
    await user.click(screen.getByRole('button', { name: 'Manage repositories' }));
    const dialog = await screen.findByRole('dialog', { name: 'Repository management' });

    const name = within(dialog).getByRole('textbox', { name: 'Repository name' });
    const description = within(dialog).getByRole('textbox', { name: 'Description' });
    const visibility = within(dialog).getByRole('combobox', { name: 'Visibility' });
    expect(visibility).toHaveValue('private');
    const gitignore = within(dialog).getByRole('combobox', { name: 'Gitignore template' });
    const license = within(dialog).getByRole('combobox', { name: 'License template' });
    await waitFor(() => {
      expect(within(gitignore).getByRole('option', { name: 'Node' })).toBeInTheDocument();
      expect(within(license).getByRole('option', { name: 'MIT License' })).toBeInTheDocument();
    });
    expect(within(visibility).getByRole('option', { name: 'Public' })).toBeInTheDocument();

    await user.type(name, 'tabs-light-fixture');
    await user.type(description, 'Fixture-only repository create UI test');
    await user.click(within(dialog).getByRole('button', { name: 'Review exact create target' }));
    const confirmation = await screen.findByRole('alertdialog', { name: 'Confirm repository creation' });
    expect(confirmation).toHaveTextContent('octocat');
    expect(confirmation).toHaveTextContent('tabs-light-fixture');
    const createButton = within(confirmation).getByRole('button', { name: 'Create octocat/tabs-light-fixture' });
    expect(context.requests.filter((request) => request.method === 'POST' && request.url.endsWith('/user/repos'))).toHaveLength(0);

    await user.click(createButton);
    await waitFor(() => expect(context.store.getState().repos.some((repo) => repo.id === '44')).toBe(true));
    expect(context.store.getState().accountWorkspace?.activeRepoId).toBe('42');
    expect(context.fixture.createdRepos[0]).toMatchObject({
      id: 44,
      name: 'tabs-light-fixture',
      private: true,
      description: 'Fixture-only repository create UI test',
    });
    const createRequest = context.requests.find((request) => request.method === 'POST' && request.url.endsWith('/user/repos'));
    const createBody = JSON.parse(createRequest?.body ?? '{}') as Record<string, unknown>;
    expect(createBody).toMatchObject({
      name: 'tabs-light-fixture',
      description: 'Fixture-only repository create UI test',
      private: true,
      auto_init: false,
    });
    expect(screen.getByText('Repository created and read back from GitHub.', { selector: 'strong' })).toBeInTheDocument();
  });

  it('elevates delete scope separately and requires exact target approval before one permanent-delete request', async () => {
    const context = await createIsolatedStore();
    const { user } = await connectAndOpenNotes(context);
    const editor = screen.getByRole('textbox', { name: 'Source for README.md' });
    await user.clear(editor);
    await user.type(editor, '# keep this local draft');
    await user.click(screen.getByRole('button', { name: 'Save Draft locally' }));
    await waitFor(async () => expect(await context.database.githubDrafts.count()).toBe(1));

    await user.click(screen.getByRole('button', { name: 'Manage repositories' }));
    const dialog = await screen.findByRole('dialog', { name: 'Repository management' });
    await user.click(within(dialog).getByRole('tab', { name: 'Permanently delete' }));
    const repoPicker = within(dialog).getByRole('combobox', { name: 'Repository to permanently delete' });
    await user.selectOptions(repoPicker, '42');
    await user.click(within(dialog).getByRole('button', { name: 'Verify deletion target and permission' }));
    const snapshot = await screen.findByLabelText('Verified deletion target');
    expect(snapshot).toHaveTextContent('octocat/notes');
    expect(screen.getByRole('button', { name: 'Request delete_repo permission' })).toBeEnabled();
    expect(context.requests.filter((request) => request.method === 'DELETE')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Request delete_repo permission' }));
    expect(await screen.findByLabelText('One-time code')).toBeInTheDocument();
    expect(context.fixture.deviceFlowScope).toBe('repo delete_repo');
    await user.click(screen.getByRole('button', { name: 'I entered the code' }));
    await waitFor(() => expect(screen.getByLabelText('Verified deletion target')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByLabelText('Verified deletion target')).toHaveTextContent(/repo.*delete_repo/));

    const exactTarget = screen.getByRole('textbox', { name: 'Type the exact owner/repository name' });
    const reviewDelete = screen.getByRole('button', { name: 'Review permanent deletion' });
    await user.type(exactTarget, 'octocat/other');
    expect(reviewDelete).toBeDisabled();
    expect(context.requests.filter((request) => request.method === 'DELETE')).toHaveLength(0);
    await user.clear(exactTarget);
    await user.type(exactTarget, 'octocat/notes');
    expect(reviewDelete).toBeEnabled();
    await user.click(reviewDelete);

    const confirmation = await screen.findByRole('alertdialog', { name: 'Confirm permanent deletion' });
    expect(within(confirmation).getByText('octocat/notes')).toBeInTheDocument();
    const deleteButton = within(confirmation).getByRole('button', { name: 'Permanently delete octocat/notes' });
    expect(context.requests.filter((request) => request.method === 'DELETE')).toHaveLength(0);
    await user.click(deleteButton);

    await waitFor(() => expect(context.store.getState().repos.some((repo) => repo.id === '42')).toBe(false));
    expect(context.fixture.deletedRepoIds.has('42')).toBe(true);
    const deleteRequests = context.requests.filter((request) => request.method === 'DELETE');
    expect(deleteRequests).toHaveLength(1);
    expect(deleteRequests[0].url).toBe('https://api.github.com/repos/octocat/notes');
    await expect(context.database.githubDrafts.count()).resolves.toBe(1);
  });

  it('stages folder, binary upload, move, explicit deletion, and confirmed undo as local drafts', async () => {
    const context = await createIsolatedStore();
    const { user } = await connectAndOpenNotes(context);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);

    await user.click(screen.getByText('Local file operations', { selector: 'summary' }));
    await user.click(screen.getByText('New folder', { selector: 'summary' }));
    const folderForm = screen.getByRole('button', { name: 'Stage folder intent' }).closest('form');
    expect(folderForm).not.toBeNull();
    await user.type(within(folderForm as HTMLFormElement).getByRole('textbox', { name: 'Folder path' }), 'empty-dir');
    await user.click(within(folderForm as HTMLFormElement).getByRole('checkbox', { name: 'Add a .gitkeep file explicitly' }));
    await user.click(within(folderForm as HTMLFormElement).getByRole('button', { name: 'Stage folder intent' }));
    await waitFor(() => expect(context.store.getState().drafts.some((draft) => draft.path === 'empty-dir/.gitkeep')).toBe(true));

    const uploadInput = screen.getByLabelText('Upload files as local drafts') as HTMLInputElement;
    const imageBytes = new Uint8Array([0, 255, 12, 128]);
    await user.upload(uploadInput, new File([imageBytes], 'fixture.png', { type: 'image/png' }));
    await waitFor(() => expect(context.store.getState().drafts.some((draft) => draft.path === 'fixture.png')).toBe(true));
    const uploaded = context.store.getState().drafts.find((draft) => draft.path === 'fixture.png');
    expect(uploaded?.binary).toBe(true);
    expect(Array.from(decodeBase64(uploaded?.newBinary ?? ''))).toEqual(Array.from(imageBytes));
    const droppedBytes = new Uint8Array([17, 0, 254, 129]);
    const dropTarget = screen.getByText(/Drop files here/).closest('.github-upload-drop');
    expect(dropTarget).not.toBeNull();
    fireEvent.drop(dropTarget as HTMLElement, { dataTransfer: { files: [new File([droppedBytes], 'dropped.dat', { type: 'application/octet-stream' })] } });
    await waitFor(() => expect(context.store.getState().drafts.some((draft) => draft.path === 'dropped.dat')).toBe(true));
    const dropped = context.store.getState().drafts.find((draft) => draft.path === 'dropped.dat');
    expect(dropped?.binary).toBe(true);
    expect(Array.from(decodeBase64(dropped?.newBinary ?? ''))).toEqual(Array.from(droppedBytes));

    await user.click(screen.getByText('Rename or move selected file', { selector: 'summary' }));
    const renameDetails = screen.getByRole('button', { name: 'Save rename or move as draft' }).closest('form');
    expect(renameDetails).not.toBeNull();
    await user.clear(within(renameDetails as HTMLFormElement).getByRole('textbox', { name: 'Repository path' }));
    await user.type(within(renameDetails as HTMLFormElement).getByRole('textbox', { name: 'Repository path' }), 'docs/README.md');
    await user.click(within(renameDetails as HTMLFormElement).getByRole('button', { name: 'Save rename or move as draft' }));
    await waitFor(() => expect(context.store.getState().drafts.find((draft) => draft.path === 'README.md')?.operation).toBe('move'));
    expect(context.store.getState().drafts.find((draft) => draft.path === 'README.md')?.newPath).toBe('docs/README.md');

    await user.click(screen.getByRole('button', { name: 'docs' }));
    await user.click(await screen.findByRole('button', { name: 'Open docs/guide.md' }));
    await waitFor(() => expect(context.store.getState().openedFile?.path).toBe('docs/guide.md'));
    await user.click(screen.getByRole('button', { name: 'Stage deletion' }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(context.store.getState().openedFile?.path).toBe('docs/guide.md');
    if (!context.store.getState().drafts.some((draft) => draft.path === 'docs/guide.md')) {
      throw new Error(`Deletion draft was not saved: ${JSON.stringify(context.store.getState().lastError)}`);
    }
    await waitFor(() => expect(context.store.getState().drafts.find((draft) => draft.path === 'docs/guide.md')?.operation).toBe('delete'));
    const changesTab = screen.getByRole('tab', { name: /Changes/ });
    await user.click(changesTab);
    await waitFor(() => expect(changesTab).toHaveAttribute('aria-selected', 'true'));
    const guideDraftPath = screen.getByText('docs/guide.md', { selector: '.github-change-path' });
    const guideDraft = guideDraftPath.closest('article');
    expect(guideDraft).not.toBeNull();
    await user.click(within(guideDraft as HTMLElement).getByRole('button', { name: 'Undo draft' }));
    await waitFor(() => expect(context.store.getState().drafts.some((draft) => draft.path === 'docs/guide.md')).toBe(false));
    expect(confirm).toHaveBeenCalled();
    expect(context.requests.filter((request) => request.url.includes('/repos/octocat/notes') && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method))).toHaveLength(0);
  });

  it('loads branch history and commit detail, then creates and switches to a fixture branch', async () => {
    const context = await createIsolatedStore();
    const { user } = await connectAndOpenNotes(context);
    await user.click(screen.getByRole('tab', { name: 'History' }));
    const historyItem = await screen.findByRole('button', { name: /Fixture history entry/ });
    await user.click(historyItem);
    const commitDetailHeading = await screen.findByRole('heading', { name: 'Commit details' });
    expect(within(commitDetailHeading.parentElement as HTMLElement).getByText('README.md')).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Create a branch from the current branch' }), 'feature-ui');
    await user.click(screen.getByRole('button', { name: 'Create branch' }));
    await waitFor(() => expect(context.fixture.branchHeads.has('notes:feature-ui')).toBe(true));
    const branchPicker = screen.getByRole('combobox', { name: 'Branch' });
    await waitFor(() => expect(screen.getByRole('option', { name: 'feature-ui' })).toBeInTheDocument());
    await user.selectOptions(branchPicker, 'feature-ui');
    await waitFor(() => expect(context.store.getState().accountWorkspace?.activeRefByRepo['42']).toBe('feature-ui'));
  });

  it('shows base, mine, and remote conflict versions and blocks selected unresolved drafts', async () => {
    const context = await createIsolatedStore();
    const { user } = await connectAndOpenNotes(context);
    const editor = screen.getByRole('textbox', { name: 'Source for README.md' });
    await user.clear(editor);
    await user.type(editor, '# mine');
    await user.click(screen.getByRole('button', { name: 'Save Draft locally' }));
    await waitFor(() => expect(context.store.getState().drafts.find((draft) => draft.path === 'README.md')?.newText).toBe('# mine'));

    context.fixture.branchHeads.set('notes:main', 'upstream-sha');
    context.fixture.commits.set('upstream-sha', { treeSha: 'tree-upstream', message: 'upstream' });
    context.fixture.remoteFiles.set('notes:README.md', '# upstream');
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(context.store.getState().drafts.find((draft) => draft.path === 'README.md')?.conflict?.kind).toBe('content'));

    const changesTab = screen.getByRole('tab', { name: /Changes/ });
    await user.click(changesTab);
    await waitFor(() => expect(changesTab).toHaveAttribute('aria-selected', 'true'));
    const conflict = screen.getByLabelText('Conflict for README.md');
    expect(within(conflict).getByText('# remote')).toBeInTheDocument();
    expect(within(conflict).getByText('# mine', { selector: 'pre' })).toBeInTheDocument();
    expect(within(conflict).getByText('# upstream')).toBeInTheDocument();
    const draftCheckbox = screen.getByRole('checkbox', { name: /README\.md/ });
    await user.click(draftCheckbox);
    const commitButton = screen.getByRole('button', { name: 'Create commit and send to octocat/notes @ main' });
    expect(commitButton).toBeDisabled();

    const customResult = within(conflict).getByRole('textbox', { name: 'Editable result' });
    await user.clear(customResult);
    await user.type(customResult, '# resolved by reviewer');
    await user.click(within(conflict).getByRole('button', { name: 'Use edited result' }));
    await waitFor(() => expect(context.store.getState().drafts.find((draft) => draft.path === 'README.md')?.conflict?.resolved).toBe(true));
    expect(context.store.getState().drafts.find((draft) => draft.path === 'README.md')?.newText).toBe('# resolved by reviewer');
    expect(commitButton).toBeEnabled();
  });

  it('renders Markdown passively and searches remote and draft content with progress', async () => {
    const context = await createIsolatedStore();
    context.fixture.remoteFiles.set('notes:README.md', '# Safe preview\n\n<script>alert(1)</script>\n\n![pixel](https://example.test/pixel.png) [external](https://example.test) needle');
    const { user } = await connectAndOpenNotes(context);

    await user.click(screen.getByRole('tab', { name: 'Preview' }));
    const preview = screen.getByRole('article', { name: 'Passive preview for README.md' });
    expect(within(preview).getByRole('heading', { name: 'Safe preview' })).toBeInTheDocument();
    expect(preview.querySelector('script, iframe, a, img')).toBeNull();

    await user.click(screen.getByRole('tab', { name: 'Source' }));
    const editor = screen.getByRole('textbox', { name: 'Source for README.md' });
    await user.clear(editor);
    await user.type(editor, '# local needle');
    await user.click(screen.getByRole('button', { name: 'Save Draft locally' }));
    await waitFor(() => expect(context.store.getState().drafts.some((draft) => draft.path === 'README.md')).toBe(true));
    const changesTab = screen.getByRole('tab', { name: /Changes/ });
    await user.click(changesTab);
    await waitFor(() => expect(changesTab).toHaveAttribute('aria-selected', 'true'));
    const search = screen.getByRole('searchbox', { name: 'Search this repository and branch, including drafts' });
    await user.type(search, 'needle');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(context.store.getState().search?.items.some((item) => item.path === 'README.md' && item.source === 'draft')).toBe(true));
    expect(context.store.getState().search?.items.some((item) => item.path === 'README.md' && item.source === 'remote')).toBe(false);
    expect(screen.getByText(/Scanned 1 remote blob/)).toBeInTheDocument();
  });

  it('keeps private AI context blocked until repository opt-in and prepares only the current file', async () => {
    const context = await createIsolatedStore();
    const { user } = await connectAndOpenNotes(context);
    render(<GithubAssistantNotice store={context.store} />);
    const consent = screen.getByRole('checkbox', { name: /Allow this private repository/ });
    const reviewFile = screen.getByRole('button', { name: 'Prepare file review' });
    expect(reviewFile).toBeDisabled();
    expect(screen.getByText(/Attachments, history, tools, and Docs context are not included/)).toBeInTheDocument();

    const requestCount = context.requests.length;
    await user.click(consent);
    await waitFor(() => expect(context.store.getState().aiConsent).toBe(true));
    expect(context.requests).toHaveLength(requestCount);
    expect(reviewFile).toBeEnabled();
    await user.click(reviewFile);
    await waitFor(() => expect(context.store.getState().preparedAi?.packet).toContain('# remote'));
    const prepared = context.store.getState().preparedAi;
    expect(prepared).toMatchObject({ purpose: 'review_file', accountId: '7', repoId: '42', ref: 'main', private: true, blocked: false });
    expect(prepared?.packet).not.toContain('Docs context');

    await user.click(consent);
    await waitFor(() => expect(context.store.getState().aiConsent).toBe(false));
    expect(context.store.getState().preparedAi).toBeNull();
  });

  it('uses the existing assistant response for commit suggestions and requires exact confirmation for AI draft edits', async () => {
    const context = await createIsolatedStore();
    const { user } = await connectAndOpenNotes(context);
    const editor = screen.getByRole('textbox', { name: 'Source for README.md' });
    await user.clear(editor);
    await user.type(editor, '# original draft');
    await user.click(screen.getByRole('button', { name: 'Save Draft locally' }));
    await waitFor(() => expect(context.store.getState().drafts.find((draft) => draft.path === 'README.md')?.newText).toBe('# original draft'));
    render(<GithubAssistantNotice store={context.store} />);
    const consent = screen.getByRole('checkbox', { name: /Allow this private repository/ });
    await user.click(consent);
    await waitFor(() => expect(context.store.getState().aiConsent).toBe(true));

    const workspaceId = 'github:7:42:main';
    await useChatStore.getState().newChat({ mode: 'writer', workspaceId, origin: 'grok' });
    const threadId = useChatStore.getState().activeThreadId;
    expect(threadId).toBeTruthy();
    const thread = threadId as string;
    aiTestThreads.push(thread);

    await user.click(screen.getByRole('button', { name: 'Prepare commit-message suggestion' }));
    await waitFor(() => expect(context.store.getState().preparedAi?.purpose).toBe('suggest_commit_message'));
    await useChatStore.getState().addMessage({
      id: 'fixture-ai-commit-message', threadId: thread, mode: 'writer', workspaceId,
      agentId: 'github', role: 'assistant', content: 'Clarify the README setup steps', timestamp: Date.now() + 1000,
    });
    await user.click(await screen.findByRole('button', { name: 'Use this commit-message suggestion' }));
    await waitFor(() => expect(context.store.getState().aiCommitMessage).toBe('Clarify the README setup steps'));
    const changesTab = screen.getByRole('tab', { name: /Changes/ });
    await user.click(changesTab);
    await waitFor(() => expect(changesTab).toHaveAttribute('aria-selected', 'true'));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Commit message' })).toHaveValue('Clarify the README setup steps'));

    await user.click(screen.getByRole('button', { name: 'Prepare draft edit' }));
    await waitFor(() => expect(context.store.getState().preparedAi?.purpose).toBe('edit_draft'));
    await useChatStore.getState().addMessage({
      id: 'fixture-ai-draft-edit', threadId: thread, mode: 'writer', workspaceId,
      agentId: 'github', role: 'assistant', content: '# AI-proposed local edit', timestamp: Date.now() + 2000,
    });
    const applyButton = await screen.findByRole('button', { name: 'Review and apply this draft edit' });
    expect(context.store.getState().drafts.find((draft) => draft.path === 'README.md')?.newText).toBe('# original draft');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await user.click(applyButton);
    await waitFor(() => expect(context.store.getState().drafts.find((draft) => draft.path === 'README.md')?.newText).toBe('# AI-proposed local edit'));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('octocat/notes @ main · README.md'));
  });

  it('shows a truthful desktop-only notice in browser preview without invoking the fixture transport', async () => {
    runtime.isTauri = false;
    const context = await createIsolatedStore();
    render(<GithubWorkspace store={context.store} />);

    expect(await screen.findByText(/browser preview cannot use native secure storage or the GitHub transport/i)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'GitHub OAuth App Client ID' })).not.toBeInTheDocument();
    expect(context.requests).toHaveLength(0);
  });
});
