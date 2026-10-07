import { describe, expect, it } from 'vitest'
import { createMemoryNativeSession } from './nativeSession'

describe('memory native auth transitions', () => {
  it('rejects a claimed account and a stale flow without promoting the pending token', async () => {
    const session = createMemoryNativeSession({ user: { id: '7', login: 'octocat' }, scopes: ['repo', 'delete_repo'] })
    const started = await session.startDevice('Iv1.abc12345', 'repo delete_repo', '7')
    expect(started.flowId.startsWith('flow.')).toBe(true)
    expect(JSON.stringify(started)).not.toContain('gho_')
    expect(JSON.stringify(started)).not.toContain('device-secret')
    await session.pollDevice('Iv1.abc12345', started.flowId)
    const probed = await session.probePendingUser(started.flowId)
    expect(probed.flowId).toBe(started.flowId)
    await expect(session.commitPendingAuth(started.flowId, '8')).rejects.toMatchObject({ code: 'target_mismatch' })
    expect(await session.hasAccess()).toBe(false)
    const replacement = await session.startDevice('Iv1.abc12345', 'repo', null)
    await session.cancelDevice(started.flowId)
    await session.discardPendingAuth(started.flowId)
    await session.pollDevice('Iv1.abc12345', replacement.flowId)
    const next = await session.probePendingUser(replacement.flowId)
    await session.commitPendingAuth(next.flowId, next.id)
    expect(await session.hasAccess()).toBe(true)
    const flow = replacement.flowId
    await session.logout()
    await expect(session.commitPendingAuth(flow, next.id)).rejects.toMatchObject({ code: 'stale_target' })
    expect(await session.hasAccess()).toBe(false)
    expect(await session.generation()).toBe(2)
  })
})
