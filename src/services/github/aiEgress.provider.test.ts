import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const runCliProvider = vi.hoisted(() => vi.fn(async (input: { runId: string }) => ({ runId: input.runId, status: 'completed' as const, text: 'ok' })))
const connectHeld = vi.hoisted(() => ({
  called: false,
  release: (() => undefined) as () => void,
}))
const startTurn = vi.hoisted(() => vi.fn(async () => 'native-turn-1'))

vi.mock('../runtime', () => ({ isTauriRuntime: () => true }))
vi.mock('../providers/chatClient', () => ({
  runCliProvider,
  stopCliProvider: vi.fn(),
  cliProviderDefaultWorkspace: vi.fn(async () => 'C:/synthetic'),
}))
vi.mock('../codex/desktopClient', () => ({
  codexDesktopClient: {
    status: vi.fn(async () => null),
    connect: vi.fn(() => new Promise((resolve) => {
      connectHeld.called = true
      connectHeld.release = () => resolve({
        epoch: 2, executablePath: 'synthetic.exe', version: 'codex-cli 0', workspaceRoot: 'C:/synthetic',
        authMode: 'chatgpt', modelProvider: 'openai',
      })
    })),
    disconnect: vi.fn(),
    listModels: vi.fn(async () => [{ id: 'fake', displayName: 'Fake', isDefault: true, reasoningEfforts: ['low'] }]),
    startThread: vi.fn(async () => 'native-thread-1'),
    resumeThread: vi.fn(async (_epoch: number, threadId: string) => threadId),
    startTurn,
    interruptTurn: vi.fn(),
    ackEvents: vi.fn(),
    readThread: vi.fn(async () => []),
    defaultWorkspace: vi.fn(async () => 'C:/synthetic'),
  },
  subscribeCodexEvents: vi.fn(async () => ({ stop: () => undefined, replayGap: false })),
}))

import { db } from '../db'
import { CliProviderSessionService } from '../providers/sessionService'
import { CodexSessionService } from '../codex/sessionService'
import {
  finalizeProviderDispatch,
  grantGithubAiConsent,
  noteGithubTarget,
  registerGithubMaterial,
  resetGithubAiEgressForTests,
  revokeGithubAiConsent,
  watchProviderThread,
} from './aiEgress'

const SECRET = 'PRIVATE_SENTINEL_do_not_leak'
const threadId = 'github-ai-thread'

describe('GitHub provider egress boundary', () => {
  beforeEach(async () => {
    resetGithubAiEgressForTests()
    connectHeld.called = false
    runCliProvider.mockClear()
    startTurn.mockClear()
    await db.delete()
    await db.open()
    await db.chatThreads.put({ id: threadId, origin: 'grok', mode: 'writer', workspaceId: 'github:1001:42:main', title: 'GitHub', createdAt: 1, updatedAt: 1 })
  })

  it('does not send private file, diff, history, or attachments without consent', async () => {
    registerGithubMaterial({ accountId: '1001', repoId: '42', ref: 'main', private: true, spans: [SECRET] })
    await db.chatMessages.add({
      id: 'old', threadId, mode: 'writer', role: 'user', content: `earlier ${SECRET}`, timestamp: 1, agentId: 'default_agent',
    })
    const service = new CliProviderSessionService()
    await service.submit({
      providerId: 'grok', modelId: 'grok-4', scope: {
        appThreadId: threadId, mode: 'writer', context: `diff ${SECRET}`, workspaceRoot: 'C:/synthetic', agentId: 'default_agent',
      }, text: `review ${SECRET}`, github: { accountId: '1001', repoId: '42', ref: 'main', private: true, purpose: 'review_diff' },
    })
    expect(runCliProvider).not.toHaveBeenCalled()
    const messages = await db.chatMessages.toArray()
    expect(JSON.stringify(messages.filter((message) => message.role === 'assistant'))).not.toContain(SECRET)
    expect(JSON.stringify(messages.filter((message) => message.role === 'assistant'))).toContain('consent')
  })

  it('strips historic private content at the final CLI dispatch even when the new text is clean', async () => {
    registerGithubMaterial({ accountId: '1001', repoId: '42', ref: 'main', private: true, spans: [SECRET] })
    await db.chatMessages.add({
      id: 'old', threadId, mode: 'writer', role: 'user', content: `historic ${SECRET}`, timestamp: 1, agentId: 'default_agent',
    })
    const service = new CliProviderSessionService()
    await service.submit({
      providerId: 'grok', modelId: 'grok-4', scope: {
        appThreadId: threadId, mode: 'writer', context: '', workspaceRoot: 'C:/synthetic', agentId: 'default_agent',
      }, text: 'hello only',
    })
    expect(runCliProvider).not.toHaveBeenCalled()
    const decision = finalizeProviderDispatch({
      provider: 'cli', text: 'hello only', context: '', history: [{ role: 'user', content: `historic ${SECRET}` }],
      attachments: [{ name: 'private.txt', content: SECRET }], images: [`image ${SECRET}`], toolOutput: `tool ${SECRET}`,
      github: { accountId: '1001', repoId: '42', ref: 'main', private: true, purpose: 'review_file' },
    })
    expect(decision.aborted).toBe(true)
    expect(decision.history).toEqual([])
    expect(decision.context).toBe('')
    expect(decision.attachments).toEqual([])
    expect(decision.images).toEqual([])
    expect(decision.toolOutput).toBe('')
    expect(JSON.stringify(decision)).not.toContain(SECRET)
  })

  it('submits an opted-in GitHub file packet through the existing CLI provider path', async () => {
    grantGithubAiConsent('1001', '42', 1)
    registerGithubMaterial({ accountId: '1001', repoId: '42', ref: 'main', private: true, spans: [SECRET] })
    const runId = '00000000-0000-4000-8000-000000000001'
    const uuid = vi.spyOn(crypto, 'randomUUID').mockReturnValue(runId)
    const service = new CliProviderSessionService()
    try {
      await service.submit({
        providerId: 'grok',
        modelId: 'grok-4',
        scope: {
          appThreadId: threadId,
          mode: 'writer',
          context: `GitHub review packet for octocat/notes @ main\n[FILE]\n${SECRET}`,
          workspaceRoot: 'C:/synthetic',
          agentId: 'default_agent',
        },
        text: 'Review the prepared GitHub file.',
        github: { accountId: '1001', repoId: '42', ref: 'main', private: true, purpose: 'review_file' },
      })
    } finally {
      uuid.mockRestore()
    }
    expect(runCliProvider).toHaveBeenCalledWith(expect.objectContaining({
      runId,
      providerId: 'grok',
      modelId: 'grok-4',
      prompt: expect.stringContaining(`[FILE]\n${SECRET}`),
    }))
    const assistant = await db.chatMessages.where('threadId').equals(threadId).filter((message) => message.role === 'assistant').first()
    expect(assistant?.content).toBe('ok')
  })

  it('aborts a queued Codex turn when consent is revoked before dispatch', async () => {
    grantGithubAiConsent('1001', '42', 1)
    registerGithubMaterial({ accountId: '1001', repoId: '42', ref: 'main', private: true, spans: [SECRET] })
    watchProviderThread(threadId, { accountId: '1001', repoId: '42', ref: 'main' })
    noteGithubTarget('1001', '42', 'main')
    await db.chatThreads.put({ id: threadId, origin: 'codex', mode: 'writer', workspaceId: 'github:1001:42:main', title: 'GitHub', createdAt: 1, updatedAt: 1 })
    const codex = new CodexSessionService()
    await codex.submit({
      clientCommandId: 'cmd-1',
      scope: {
        appThreadId: threadId, mode: 'writer', workspaceId: 'github:1001:42:main', workspaceRoot: 'C:/synthetic', permissionProfile: 'readOnly',
        agentId: 'default_agent', context: `file ${SECRET}`, capturedAt: 1,
        github: { accountId: '1001', repoId: '42', ref: 'main', private: true, purpose: 'review_file' },
      },
      text: 'review the diff',
    })
    revokeGithubAiConsent('1001', '42')
    await vi.waitFor(() => expect(connectHeld.called).toBe(true))
    connectHeld.release()
    await vi.waitFor(async () => {
      const run = await db.codexRuns.toArray()
      expect(run[0]?.status).toBe('cancelled')
    })
    expect(startTurn).not.toHaveBeenCalled()
    expect(JSON.stringify(await db.codexRuns.toArray())).not.toContain(SECRET)
  })
})
