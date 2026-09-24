import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import readline from 'node:readline';

const mode = process.argv[2] ?? 'normal';
const childPidFile = process.argv[3];

if (childPidFile && mode === 'normal') {
  setTimeout(() => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore', windowsHide: true,
  });
    writeFileSync(childPidFile, String(child.pid));
  }, 150);
}

const send = value => process.stdout.write(`${JSON.stringify(value)}\n`);
const reply = (id, result) => send({ id, result });
let workspaceRoot = '';

const input = readline.createInterface({ input: process.stdin });
input.on('line', line => {
  const message = JSON.parse(line);
  if (message.id === 700) {
    send({ method: 'turn/completed', params: { threadId: 'fake-thread', turn: { id: 'fake-turn', status: 'completed' } } });
    return;
  }
  if (message.id === 701 || message.id === 702) {
    if (message.error?.code === -32601) {
      send({ method: 'item/agentMessage/delta', params: { threadId: 'fake-thread',
        turnId: 'fake-turn', itemId: 'fake-item', delta: `rejected-${message.id}` } });
    }
    return;
  }
  if (message.id === 703) {
    send({ method: 'item/agentMessage/delta', params: { threadId: 'fake-thread',
      turnId: 'fake-turn', itemId: 'fake-item', delta: message.result?.success ? 'business-applied' : 'business-rejected' } });
    send({ method: 'turn/completed', params: { threadId: 'fake-thread', turn: { id: 'fake-turn', status: 'completed' } } });
    return;
  }
  if (!message.id) return;
  if (mode === 'timeout') return;
  if (mode === 'malformed') { process.stdout.write('{bad}\n'); return; }
  if (mode === 'oversized') { process.stdout.write(`${'x'.repeat(1024 * 1024 + 1)}\n`); return; }
  if (mode === 'eof') { process.exit(0); }
  switch (message.method) {
    case 'initialize':
      if (mode === 'stderr') process.stderr.write('synthetic noisy stderr\n');
      reply(message.id, { platformFamily: 'windows', platformOs: 'windows' });
      if (mode === 'unknown-request') {
        send({ id: 701, method: 'unadvertised/action', params: { threadId: 'fake-thread', turnId: 'fake-turn' } });
      }
      break;
    case 'account/read': reply(message.id, { account: { type: 'chatgpt' } }); break;
    case 'config/read': reply(message.id, { config: {
      model_provider: 'openai', mcp_servers: {}, model_providers: {},
      features: { plugins: false, hooks: false, remote_plugin: false, apps: false },
      windows: { sandbox: 'elevated' },
      web_search: 'disabled',
    } }); break;
    case 'mcpServerStatus/list': reply(message.id, { data: [] }); break;
    case 'model/list': reply(message.id, { data: [{ id: 'fake-model', displayName: 'Fake Model', isDefault: true,
      supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }] }] }); break;
    case 'thread/start': {
      workspaceRoot = message.params.cwd;
      if (mode === 'business' && !message.params.dynamicTools?.some(tool => tool.name === 'tabs_tasks_list_v1')) {
        send({ id: message.id, error: { code: -32602, message: 'Expected advertised tool' } });
      } else reply(message.id, { thread: { id: 'fake-thread' } });
      break;
    }
    case 'thread/resume': reply(message.id, { thread: { id: message.params.threadId } }); break;
    case 'thread/read': reply(message.id, { thread: { id: message.params.threadId,
      cwd: workspaceRoot, turns: [{ id: 'fake-turn', status: 'completed', items: [
        { id: 'fake-item', type: 'agentMessage', text: mode === 'business' ? 'business-applied' : 'café' },
      ] }] } }); break;
    case 'turn/start': {
      reply(message.id, { turn: { id: 'fake-turn' } });
      if (mode === 'business') {
        send({ method: 'turn/started', params: { threadId: 'fake-thread',
          turn: { id: 'fake-turn', status: 'inProgress' } } });
        send({ id: 703, method: 'item/tool/call', params: { threadId: 'fake-thread',
          turnId: 'fake-turn', callId: 'fake-business-call', tool: 'tabs_tasks_list_v1', arguments: {} } });
        break;
      }
      if (mode === 'unknown-request') {
        send({ method: 'turn/started', params: { threadId: 'fake-thread',
          turn: { id: 'fake-turn', status: 'inProgress' } } });
        send({ id: 702, method: 'item/tool/call', params: { threadId: 'fake-thread',
          turnId: 'fake-turn', callId: 'fake-call', tool: 'tabs_tasks_list_v1', arguments: {} } });
        break;
      }
      const delta = JSON.stringify({ method: 'item/agentMessage/delta', params: {
        threadId: 'fake-thread', turnId: 'fake-turn', itemId: 'fake-item', delta: 'café',
      } }) + '\n';
      const bytes = Buffer.from(delta);
      const accent = bytes.indexOf(Buffer.from('é'));
      process.stdout.write(bytes.subarray(0, accent + 1));
      setTimeout(() => {
        process.stdout.write(bytes.subarray(accent + 1));
        send({ method: 'item/started', params: { threadId: 'fake-thread', turnId: 'fake-turn',
          item: { id: 'fake-change', type: 'fileChange', status: 'inProgress', changes: [] } } });
        send({ method: 'item/fileChange/patchUpdated', params: { threadId: 'fake-thread',
          turnId: 'fake-turn', itemId: 'fake-change', changes: [{ path: 'fixture.txt', kind: 'add' }] } });
        send({ id: 700, method: 'item/fileChange/requestApproval', params: {
          threadId: 'fake-thread', turnId: 'fake-turn', itemId: 'fake-change', reason: 'Synthetic change',
        } });
      }, 10);
      break;
    }
    case 'turn/interrupt':
      reply(message.id, {});
      send({ method: 'turn/completed', params: { threadId: 'fake-thread', turn: { id: 'fake-turn', status: 'interrupted' } } });
      break;
    default: send({ id: message.id, error: { code: -32601, message: 'unknown method' } });
  }
});
input.on('close', () => process.exit(0));
