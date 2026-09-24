import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(await readFile(join(here, 'codex-0.155.1.json'), 'utf8'));
assert.equal(process.platform, 'win32', 'This fixture verifies the Windows PATH installation');
const scratch = await mkdtemp(join(tmpdir(), 'tabs-codex-schema-'));

try {
  const schemaDir = join(scratch, 'schema');
  const codexHome = join(scratch, 'codex-home');
  await mkdir(schemaDir);
  await mkdir(codexHome);
  const options = {
    cwd: schemaDir,
    env: { ...process.env, CODEX_HOME: codexHome },
    windowsHide: true,
    timeout: 20000,
    maxBuffer: 1024 * 1024,
  };
  const version = await exec('cmd.exe', ['/d', '/c', 'codex --version'], options);
  assert.equal(version.stdout.trim(), fixture.cliVersion);
  await exec('cmd.exe', ['/d', '/c', 'codex app-server generate-json-schema --experimental --out .'], options);
  const bundle = await readFile(join(schemaDir, fixture.bundle));
  assert.equal(createHash('sha256').update(bundle).digest('hex'), fixture.sha256);
  const schema = JSON.parse(bundle.toString('utf8'));
  const client = new Set(schema.definitions.ClientRequest.oneOf.map(request => request.properties.method.enum[0]));
  const server = JSON.parse(await readFile(join(schemaDir, 'ServerRequest.json'), 'utf8'));
  const serverMethods = new Set(server.oneOf.map(request => request.properties.method.enum[0]));
  for (const method of fixture.requiredClientMethods) assert.ok(client.has(method), method);
  for (const method of fixture.requiredServerMethods) assert.ok(serverMethods.has(method), method);
  assert.equal(schema.definitions.InitializeCapabilities.properties.experimentalApi.type, 'boolean');
  assert.equal(schema.definitions.ThreadStartParams.properties.dynamicTools.items.$ref, '#/definitions/DynamicToolSpec');
  assert.ok(schema.definitions.ThreadResumeParams.required.includes('threadId'));
  assert.ok(schema.definitions.TurnStartParams.required.includes('threadId'));
  assert.ok(schema.definitions.TurnInterruptParams.required.includes('turnId'));
  const call = JSON.parse(await readFile(join(schemaDir, 'DynamicToolCallParams.json'), 'utf8'));
  const reply = JSON.parse(await readFile(join(schemaDir, 'DynamicToolCallResponse.json'), 'utf8'));
  assert.deepEqual(call.required, ['arguments', 'callId', 'threadId', 'tool', 'turnId']);
  assert.deepEqual(reply.required, ['contentItems', 'success']);
  console.log(fixture.cliVersion + ': experimental app-server schema matches pinned fixture; live compatibility remains unverified');
} finally {
  const base = resolve(tmpdir()).toLowerCase() + sep;
  assert.ok(resolve(scratch).toLowerCase().startsWith(base), 'Scratch must be inside temp');
  await rm(scratch, { recursive: true, force: true });
}
