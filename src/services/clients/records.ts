import type { Client } from '../../types';
import type {
  ClientAttachment,
  ClientContact,
  ClientDraft,
  ClientNote,
  ClientProfile,
  ClientRecordErrorCode,
  ClientRecordResult,
  ContactDraftValue,
  NoteDraftValue,
  ProfileDraftValue,
} from '../../types/clients';
import type { TabsDB } from '../db';
import { isNoClient } from '../../stores/clientOverview';
import { nanoid } from 'nanoid';
import { CLIENTS_ACTOR_KEY, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_OWNER } from './schema';
import { validateContact, validateNote, validateProfile } from './validation';

interface ClientDraftRuntimeState {
  durableGenerations: Map<string, Map<number, ClientDraft>>;
  discardedSessions: Map<string, { attempts: Set<symbol>; succeeded: boolean }>;
}

const clientDraftRuntimeStates = new WeakMap<TabsDB, ClientDraftRuntimeState>();

function clientDraftRuntimeState(database: TabsDB): ClientDraftRuntimeState {
  const current = clientDraftRuntimeStates.get(database);
  if (current) return current;
  const created: ClientDraftRuntimeState = { durableGenerations: new Map(), discardedSessions: new Map() };
  clientDraftRuntimeStates.set(database, created);
  return created;
}

function draftSessionKey(id: string, editSessionId: string): string {
  return JSON.stringify([id, editSessionId]);
}

class RecordFailure extends Error {
  readonly code: ClientRecordErrorCode;
  readonly field?: string;

  constructor(code: ClientRecordErrorCode, field?: string) {
    super(code);
    this.code = code;
    if (field) this.field = field;
  }
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}

function validRevision(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 1);
}

function validCurrentRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function cloneClient(client: Client): Client {
  return { ...client };
}

function sameClientSnapshot(left: Client, right: Client): boolean {
  return left.id === right.id
    && left.name === right.name
    && left.color === right.color
    && left.createdAt === right.createdAt
    && left.order === right.order;
}

function cloneProfile(profile: ClientProfile): ClientProfile {
  return { ...profile, clientSnapshot: cloneClient(profile.clientSnapshot) };
}

function cloneContact(contact: ClientContact): ClientContact {
  return { ...contact };
}

function cloneNote(note: ClientNote): ClientNote {
  return { ...note, contactSnapshot: note.contactSnapshot ? { ...note.contactSnapshot } : null };
}

function cloneDraft(draft: ClientDraft): ClientDraft {
  if (draft.kind === 'profile') return { ...draft, value: { ...draft.value } };
  if (draft.kind === 'contact') return { ...draft, value: { ...draft.value } };
  return { ...draft, value: { ...draft.value } };
}

function cloneAttachment(attachment: ClientAttachment): ClientAttachment {
  const size = blobSize(attachment.data);
  const type = blobType(attachment.data);
  const slice = Blob.prototype.slice;
  return { ...attachment, data: slice.call(attachment.data, 0, size, type) };
}

function validGeneration(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function checkedTime(clock: () => number): number {
  const now = clock();
  if (!Number.isFinite(now) || now < 0) throw new RecordFailure('STORAGE');
  return now;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareContact(left: ClientContact, right: ClientContact): number {
  return compareText(left.name.toLowerCase(), right.name.toLowerCase()) || compareText(left.id, right.id);
}

function validOwner(client: Client | undefined, clientId: string): Client {
  if (!client) throw new RecordFailure('DETACHED');
  if (client.id !== clientId) throw new RecordFailure('STORAGE');
  if (isNoClient(client)) throw new RecordFailure('VALIDATION', 'clientId');
  return client;
}

function validateStoredRevision(revision: number): void {
  if (!Number.isSafeInteger(revision) || revision < 1) throw new RecordFailure('STORAGE');
}

function incrementRevision(revision: number): number {
  validateStoredRevision(revision);
  if (revision >= Number.MAX_SAFE_INTEGER) throw new RecordFailure('STORAGE');
  return revision + 1;
}

function checkExpectedRevision(current: { revision: number } | undefined, expectedRevision: number | null): void {
  if (current) validateStoredRevision(current.revision);
  if (current ? current.revision !== expectedRevision : expectedRevision !== null) {
    throw new RecordFailure('CONFLICT');
  }
}

async function ensureProfile(
  database: TabsDB,
  client: Client,
  now: number,
): Promise<ClientProfile> {
  const existing = await database.clientProfiles.get(client.id);
  if (existing) {
    if (existing.clientId !== client.id) throw new RecordFailure('STORAGE');
    validateStoredRevision(existing.revision);
    if (sameClientSnapshot(existing.clientSnapshot, client)) return existing;
    const refreshed: ClientProfile = {
      ...existing,
      clientSnapshot: cloneClient(client),
      revision: incrementRevision(existing.revision),
      updatedAt: now,
    };
    await database.clientProfiles.put(refreshed);
    return refreshed;
  }
  const profile: ClientProfile = {
    clientId: client.id,
    clientSnapshot: cloneClient(client),
    website: '',
    description: '',
    primaryContactId: null,
    revision: 1,
    updatedAt: now,
  };
  await database.clientProfiles.add(profile);
  return profile;
}

function validateDraft(draft: ClientDraft): ClientRecordResult<ClientDraft> {
  if (!draft || typeof draft !== 'object') return { ok: false, code: 'VALIDATION', field: 'draft' };
  if (!validId(draft.id)) return { ok: false, code: 'VALIDATION', field: 'id' };
  if (!validId(draft.clientId)) return { ok: false, code: 'VALIDATION', field: 'clientId' };
  if (!validId(draft.editSessionId)) return { ok: false, code: 'VALIDATION', field: 'editSessionId' };
  if (!validId(draft.recordId)) return { ok: false, code: 'VALIDATION', field: 'recordId' };
  if (!validGeneration(draft.generation)) return { ok: false, code: 'VALIDATION', field: 'generation' };
  if (draft.baseRevision !== null && !validRevision(draft.baseRevision)) {
    return { ok: false, code: 'VALIDATION', field: 'baseRevision' };
  }
  if (!Number.isFinite(draft.updatedAt) || draft.updatedAt < 0) {
    return { ok: false, code: 'VALIDATION', field: 'updatedAt' };
  }
  if (draft.kind === 'profile') {
    if (!draft.value || typeof draft.value.website !== 'string'
      || typeof draft.value.description !== 'string') {
      return { ok: false, code: 'VALIDATION', field: 'value' };
    }
    return { ok: true, value: { ...draft, value: { ...draft.value } } };
  }
  if (draft.kind === 'contact') {
    if (!draft.value || typeof draft.value.name !== 'string' || typeof draft.value.role !== 'string'
      || typeof draft.value.email !== 'string' || typeof draft.value.phone !== 'string') {
      return { ok: false, code: 'VALIDATION', field: 'value' };
    }
    return { ok: true, value: { ...draft, value: { ...draft.value } } };
  }
  if (draft.kind === 'note') {
    if (!draft.value || typeof draft.value.title !== 'string' || typeof draft.value.bodyText !== 'string') {
      return { ok: false, code: 'VALIDATION', field: 'value' };
    }
    if (draft.value.kind !== 'call' && draft.value.kind !== 'meeting'
      && draft.value.kind !== 'decision' && draft.value.kind !== 'note') {
      return { ok: false, code: 'VALIDATION', field: 'kind' };
    }
    if (typeof draft.value.occurredAt !== 'number' || !Number.isFinite(draft.value.occurredAt)
      || draft.value.occurredAt < 0) {
      return { ok: false, code: 'VALIDATION', field: 'occurredAt' };
    }
    if (draft.value.contactId !== null && typeof draft.value.contactId !== 'string') {
      return { ok: false, code: 'VALIDATION', field: 'contactId' };
    }
    return { ok: true, value: { ...draft, value: { ...draft.value } } };
  }
  return { ok: false, code: 'VALIDATION', field: 'kind' };
}

function sameDraftContent(left: ClientDraft, right: ClientDraft): boolean {
  return sameDraftContentExceptBaseRevision(left, right)
    && left.baseRevision === right.baseRevision;
}

function sameDraftContentExceptBaseRevision(left: ClientDraft, right: ClientDraft): boolean {
  return left.kind === right.kind
    && left.id === right.id
    && left.clientId === right.clientId
    && left.editSessionId === right.editSessionId
    && left.recordId === right.recordId
    && left.generation === right.generation
    && JSON.stringify(left.value) === JSON.stringify(right.value);
}

function noteDraftEqualsValue(draft: ClientDraft, value: NoteDraftValue): boolean {
  if (draft.kind !== 'note') return false;
  return JSON.stringify(draft.value) === JSON.stringify(value);
}

export interface ClientDraftAcknowledgement {
  id: string;
  generation: number;
  editSessionId: string;
}

function validateDraftAcknowledgement(value: unknown): value is ClientDraftAcknowledgement {
  if (typeof value !== 'object' || value === null) return false;
  const acknowledgement = value as Partial<ClientDraftAcknowledgement>;
  return validId(acknowledgement.id)
    && validGeneration(acknowledgement.generation)
    && validId(acknowledgement.editSessionId);
}

export function clientDraftId(clientId: string, kind: ClientDraft['kind'], recordId: string): string {
  return JSON.stringify([clientId, kind, recordId]);
}

async function verifyDraftAcknowledgement(
  database: TabsDB,
  acknowledgement: ClientDraftAcknowledgement,
  durableGenerations: ReadonlyMap<number, ClientDraft> | undefined,
  expected:
    | { clientId: string; kind: 'profile'; recordId: string; baseRevision: number | null; value: ProfileDraftValue }
    | { clientId: string; kind: 'contact'; recordId: string; baseRevision: number | null; value: ContactDraftValue },
): Promise<ClientDraft> {
  const draft = await database.clientDrafts.get(acknowledgement.id);
  if (!draft || draft.id !== acknowledgement.id || draft.clientId !== expected.clientId
    || draft.kind !== expected.kind || draft.recordId !== expected.recordId
    || draft.editSessionId !== acknowledgement.editSessionId
    || !validGeneration(draft.generation) || draft.generation < acknowledgement.generation
    || draft.baseRevision !== expected.baseRevision) {
    throw new RecordFailure('CONFLICT');
  }
  const acknowledged = draft.generation === acknowledgement.generation
    ? draft
    : durableGenerations?.get(acknowledgement.generation);
  if (!acknowledged || acknowledged.id !== draft.id || acknowledged.clientId !== draft.clientId
    || acknowledged.kind !== draft.kind || acknowledged.recordId !== draft.recordId
    || acknowledged.editSessionId !== draft.editSessionId
    || acknowledged.generation !== acknowledgement.generation
    || acknowledged.baseRevision !== expected.baseRevision) {
    throw new RecordFailure('CONFLICT');
  }
  if (acknowledged.kind === 'profile' && expected.kind === 'profile') {
    const value = validateProfile(acknowledged.value);
    if (!value.ok || JSON.stringify(value.value) !== JSON.stringify(expected.value)) {
      throw new RecordFailure('CONFLICT');
    }
  } else if (acknowledged.kind === 'contact' && expected.kind === 'contact') {
    const value = validateContact(acknowledged.value);
    if (!value.ok || JSON.stringify(value.value) !== JSON.stringify(expected.value)) {
      throw new RecordFailure('CONFLICT');
    }
  } else {
    throw new RecordFailure('CONFLICT');
  }
  return draft;
}

async function finishDraftAcknowledgement(
  database: TabsDB,
  draft: ClientDraft,
  acknowledgedGeneration: number,
  revision: number,
  now: number,
): Promise<void> {
  if (draft.kind !== 'profile' && draft.kind !== 'contact') throw new RecordFailure('CONFLICT');
  const attachments = await database.clientAttachments.where('[ownerType+ownerId]')
    .equals(['draft', draft.id]).toArray();
  if (attachments.some((attachment) => attachment.clientId !== draft.clientId
    || attachment.ownerType !== 'draft' || attachment.ownerId !== draft.id)) {
    throw new RecordFailure('CONFLICT');
  }
  if (draft.generation === acknowledgedGeneration && attachments.length === 0) {
    await database.clientDrafts.delete(draft.id);
    return;
  }
  // Keep newer text and draft-owned bytes; only advance the canonical base.
  await database.clientDrafts.put({ ...draft, baseRevision: revision, updatedAt: now });
}

async function persistDraft(
  database: TabsDB,
  nextDraft: ClientDraft,
  clock: () => number,
  isDiscarded: (draft: ClientDraft) => boolean = () => false,
): Promise<ClientDraft> {
  if (isDiscarded(nextDraft)) throw new RecordFailure('CONFLICT');
  if (nextDraft.kind === 'profile' && nextDraft.recordId !== nextDraft.clientId) {
    throw new RecordFailure('VALIDATION', 'recordId');
  }
  const client = validOwner(await database.clients.get(nextDraft.clientId), nextDraft.clientId);
  if (nextDraft.kind === 'note') {
    const target = await database.clientNotes.get(nextDraft.recordId);
    if (target) {
      if (target.clientId !== nextDraft.clientId) throw new RecordFailure('CONFLICT');
      if (target.deletedAt !== undefined) throw new RecordFailure('NOT_FOUND');
      validateStoredRevision(target.revision);
      if (nextDraft.baseRevision !== target.revision) throw new RecordFailure('CONFLICT');
    } else if (nextDraft.baseRevision !== null) {
      throw new RecordFailure('CONFLICT');
    }
  } else if (nextDraft.kind === 'contact') {
    const target = await database.clientContacts.get(nextDraft.recordId);
    if (target) {
      if (target.clientId !== nextDraft.clientId) throw new RecordFailure('CONFLICT');
      if (target.deletedAt !== undefined) throw new RecordFailure('NOT_FOUND');
      validateStoredRevision(target.revision);
      if (nextDraft.baseRevision !== target.revision) throw new RecordFailure('CONFLICT');
    } else if (nextDraft.baseRevision !== null) {
      throw new RecordFailure('CONFLICT');
    }
  }

  const current = await database.clientDrafts.get(nextDraft.id);
  if (current) {
    if (current.clientId !== nextDraft.clientId || current.kind !== nextDraft.kind
      || current.recordId !== nextDraft.recordId || current.editSessionId !== nextDraft.editSessionId) {
      throw new RecordFailure('CONFLICT');
    }
    if (!validGeneration(current.generation)) throw new RecordFailure('STORAGE');
    if (current.generation > nextDraft.generation) throw new RecordFailure('CONFLICT');
    if (current.generation === nextDraft.generation) {
      if (sameDraftContent(current, nextDraft)) return current;
      if (nextDraft.kind === 'profile' && nextDraft.baseRevision === null
        && sameDraftContentExceptBaseRevision(current, nextDraft)) {
        const profile = await database.clientProfiles.get(nextDraft.clientId);
        if (profile && profile.clientId === nextDraft.clientId
          && current.baseRevision === profile.revision) return current;
      }
      throw new RecordFailure('CONFLICT');
    }
    if (current.baseRevision !== nextDraft.baseRevision) throw new RecordFailure('CONFLICT');
  }

  const profileBefore = nextDraft.kind === 'profile'
    ? await database.clientProfiles.get(nextDraft.clientId)
    : undefined;
  const now = checkedTime(clock);
  const profile = await ensureProfile(database, client, now);
  let savedDraft = nextDraft;
  if (nextDraft.kind === 'profile') {
    if (nextDraft.baseRevision === null) {
      if (profileBefore || current) throw new RecordFailure('CONFLICT');
      savedDraft = { ...nextDraft, baseRevision: profile.revision };
    } else if (nextDraft.baseRevision !== profile.revision) {
      throw new RecordFailure('CONFLICT');
    }
  }
  if (isDiscarded(nextDraft)) throw new RecordFailure('CONFLICT');
  await database.clientDrafts.put(savedDraft);
  return savedDraft;
}

function blobSize(blob: Blob): number {
  const getter = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')?.get;
  if (!getter) throw new RecordFailure('STORAGE');
  const value: unknown = getter.call(blob);
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new RecordFailure('STORAGE');
  }
  return value;
}

function blobType(blob: Blob): string {
  const getter = Object.getOwnPropertyDescriptor(Blob.prototype, 'type')?.get;
  if (!getter) throw new RecordFailure('STORAGE');
  const value: unknown = getter.call(blob);
  if (typeof value !== 'string') throw new RecordFailure('STORAGE');
  return value;
}

function fileName(file: File): string {
  const getter = Object.getOwnPropertyDescriptor(File.prototype, 'name')?.get;
  if (!getter) throw new RecordFailure('VALIDATION', 'file');
  const value: unknown = getter.call(file);
  if (typeof value !== 'string') throw new RecordFailure('VALIDATION', 'file');
  return value;
}

function sameAttachmentMetadata(
  left: ClientAttachment,
  right: Pick<ClientAttachment, 'id' | 'clientId' | 'ownerType' | 'ownerId' | 'displayName' | 'mime' | 'bytes'>,
): boolean {
  return left.id === right.id
    && left.clientId === right.clientId
    && left.ownerType === right.ownerType
    && left.ownerId === right.ownerId
    && left.displayName === right.displayName
    && left.mime === right.mime
    && left.bytes === right.bytes;
}

async function readBlobBytes(blob: Blob): Promise<ArrayBuffer> {
  const method = Blob.prototype.arrayBuffer;
  const result: unknown = await method.call(blob);
  if (!(result instanceof ArrayBuffer)) throw new RecordFailure('STORAGE');
  return result;
}

async function prepareAttachment(file: unknown): Promise<{
  displayName: string;
  mime: string;
  bytes: number;
  data: Blob;
}> {
  if (typeof File === 'undefined' || !(file instanceof File)) {
    throw new RecordFailure('VALIDATION', 'file');
  }

  let displayName: string;
  let mime: string;
  let bytes: number;
  try {
    displayName = fileName(file);
    mime = blobType(file);
    bytes = blobSize(file);
  } catch (error) {
    if (error instanceof RecordFailure) throw error;
    throw new RecordFailure('VALIDATION', 'file');
  }
  if (bytes > MAX_ATTACHMENT_BYTES) throw new RecordFailure('LIMIT', 'file');

  const buffer = await readBlobBytes(file);
  if (buffer.byteLength !== bytes) throw new RecordFailure('STORAGE');
  const data = new Blob([buffer], { type: mime });
  if (blobSize(data) !== bytes || blobType(data) !== mime) throw new RecordFailure('STORAGE');
  return { displayName, mime, bytes, data };
}

function validateStoredAttachment(attachment: ClientAttachment): void {
  const size = blobSize(attachment.data);
  const type = blobType(attachment.data);
  if (!Number.isSafeInteger(attachment.bytes) || attachment.bytes < 0
    || attachment.bytes > MAX_ATTACHMENT_BYTES || attachment.bytes !== size
    || attachment.mime !== type) {
    throw new RecordFailure('STORAGE');
  }
}

async function sameBlob(left: Blob, right: Blob): Promise<boolean> {
  if (blobSize(left) !== blobSize(right) || blobType(left) !== blobType(right)) return false;
  const [leftBytes, rightBytes] = await Promise.all([readBlobBytes(left), readBlobBytes(right)]);
  const a = new Uint8Array(leftBytes);
  const b = new Uint8Array(rightBytes);
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

function resultFailure<T>(error: unknown): ClientRecordResult<T> {
  if (error instanceof RecordFailure) {
    return { ok: false, code: error.code, ...(error.field ? { field: error.field } : {}) };
  }
  return { ok: false, code: 'STORAGE' };
}

export function createClientRecords(database: TabsDB, clock: () => number = Date.now) {
  const runtime = clientDraftRuntimeState(database);
  const durableDraftGenerations = runtime.durableGenerations;
  const isDraftDiscarded = (draft: ClientDraft): boolean =>
    runtime.discardedSessions.has(draftSessionKey(draft.id, draft.editSessionId));
  const rememberDraftGeneration = (draft: ClientDraft): void => {
    if (draft.kind === 'note' || isDraftDiscarded(draft)) return;
    const validation = draft.kind === 'profile'
      ? validateProfile(draft.value)
      : validateContact(draft.value);
    if (!validation.ok) return;
    const key = draftSessionKey(draft.id, draft.editSessionId);
    const generations = durableDraftGenerations.get(key) ?? new Map<number, ClientDraft>();
    generations.set(draft.generation, cloneDraft(draft));
    durableDraftGenerations.set(key, generations);
  };
  const durableGenerationsFor = (acknowledgement: ClientDraftAcknowledgement) =>
    durableDraftGenerations.get(draftSessionKey(acknowledgement.id, acknowledgement.editSessionId));
  const isAcknowledgementDiscarded = (acknowledgement: ClientDraftAcknowledgement): boolean =>
    runtime.discardedSessions.has(draftSessionKey(acknowledgement.id, acknowledgement.editSessionId));
  const forgetAcknowledgedGenerations = (acknowledgement: ClientDraftAcknowledgement): void => {
    const key = draftSessionKey(acknowledgement.id, acknowledgement.editSessionId);
    const generations = durableDraftGenerations.get(key);
    if (!generations) return;
    for (const generation of generations.keys()) {
      if (generation <= acknowledgement.generation) generations.delete(generation);
    }
    if (!generations.size) durableDraftGenerations.delete(key);
  };
  const forgetDraftSession = (id: string, editSessionId: string): void => {
    durableDraftGenerations.delete(draftSessionKey(id, editSessionId));
  };

  return {
    getProfile: async (clientId: string): Promise<ClientRecordResult<ClientProfile | null>> => {
      if (!validId(clientId)) return { ok: false, code: 'VALIDATION', field: 'clientId' };
      try {
        const profile = await database.clientProfiles.get(clientId);
        return { ok: true, value: profile ? cloneProfile(profile) : null };
      } catch {
        return { ok: false, code: 'STORAGE' };
      }
    },
    saveProfile: async (input: {
      clientId: string;
      expectedRevision: number | null;
      value: ProfileDraftValue;
      draftAck?: ClientDraftAcknowledgement;
    }): Promise<ClientRecordResult<ClientProfile>> => {
      if (!input || !validId(input.clientId)) return { ok: false, code: 'VALIDATION', field: 'clientId' };
      if (!validRevision(input.expectedRevision)) {
        return { ok: false, code: 'VALIDATION', field: 'expectedRevision' };
      }
      if (input.draftAck !== undefined && !validateDraftAcknowledgement(input.draftAck)) {
        return { ok: false, code: 'VALIDATION', field: 'draftAck' };
      }
      const validation = validateProfile(input.value);
      if (!validation.ok) return validation;
      try {
        const profile = await database.transaction(
          'rw', database.clients, database.clientProfiles, database.clientDrafts, database.clientAttachments,
          async () => {
          const client = validOwner(await database.clients.get(input.clientId), input.clientId);
          const current = await database.clientProfiles.get(input.clientId);
          if (current && current.clientId !== input.clientId) throw new RecordFailure('STORAGE');
          if (current) validateStoredRevision(current.revision);
          if (current ? input.expectedRevision !== current.revision : input.expectedRevision !== null) {
            throw new RecordFailure('CONFLICT');
          }
          if (input.draftAck && isAcknowledgementDiscarded(input.draftAck)) {
            throw new RecordFailure('CONFLICT');
          }
          const acknowledgedDraft = input.draftAck
            ? await verifyDraftAcknowledgement(database, input.draftAck, durableGenerationsFor(input.draftAck), {
              clientId: input.clientId, kind: 'profile', recordId: input.clientId,
              baseRevision: input.expectedRevision, value: validation.value,
            })
            : null;
          if (input.draftAck && isAcknowledgementDiscarded(input.draftAck)) {
            throw new RecordFailure('CONFLICT');
          }
          const updatedAt = checkedTime(clock);
          const next: ClientProfile = {
            clientId: input.clientId,
            clientSnapshot: cloneClient(client),
            website: validation.value.website,
            description: validation.value.description,
            primaryContactId: current?.primaryContactId ?? null,
            revision: current ? incrementRevision(current.revision) : 1,
            updatedAt,
          };
          await database.clientProfiles.put(next);
          if (input.draftAck && isAcknowledgementDiscarded(input.draftAck)) {
            throw new RecordFailure('CONFLICT');
          }
          if (acknowledgedDraft && input.draftAck) {
            await finishDraftAcknowledgement(database, acknowledgedDraft, input.draftAck.generation,
              next.revision, updatedAt);
          }
          if (input.draftAck && isAcknowledgementDiscarded(input.draftAck)) {
            throw new RecordFailure('CONFLICT');
          }
          return next;
        });
        if (input.draftAck) forgetAcknowledgedGenerations(input.draftAck);
        return { ok: true, value: cloneProfile(profile) };
      } catch (error) {
        return resultFailure(error);
      }
    },
    listContacts: async (clientId: string): Promise<ClientRecordResult<ClientContact[]>> => {
      if (!validId(clientId)) return { ok: false, code: 'VALIDATION', field: 'clientId' };
      try {
        const contacts = await database.clientContacts.where('clientId').equals(clientId).toArray();
        return {
          ok: true,
          value: contacts.filter((contact) => contact.deletedAt === undefined)
            .sort(compareContact).map(cloneContact),
        };
      } catch {
        return { ok: false, code: 'STORAGE' };
      }
    },
    saveContact: async (input: {
      id: string;
      clientId: string;
      expectedRevision: number | null;
      value: ContactDraftValue;
      draftAck?: ClientDraftAcknowledgement;
    }): Promise<ClientRecordResult<ClientContact>> => {
      if (!input || !validId(input.id)) return { ok: false, code: 'VALIDATION', field: 'id' };
      if (!validId(input.clientId)) return { ok: false, code: 'VALIDATION', field: 'clientId' };
      if (!validRevision(input.expectedRevision)) {
        return { ok: false, code: 'VALIDATION', field: 'expectedRevision' };
      }
      if (input.draftAck !== undefined && !validateDraftAcknowledgement(input.draftAck)) {
        return { ok: false, code: 'VALIDATION', field: 'draftAck' };
      }
      const validation = validateContact(input.value);
      if (!validation.ok) return validation;
      try {
        const contact = await database.transaction(
          'rw', database.clients, database.clientProfiles, database.clientContacts,
          database.clientDrafts, database.clientAttachments, async () => {
            const client = validOwner(await database.clients.get(input.clientId), input.clientId);
            const current = await database.clientContacts.get(input.id);
            if (current && current.clientId !== input.clientId) throw new RecordFailure('CONFLICT');
            if (current?.deletedAt !== undefined) throw new RecordFailure('NOT_FOUND');
            checkExpectedRevision(current, input.expectedRevision);
            if (input.draftAck && isAcknowledgementDiscarded(input.draftAck)) {
              throw new RecordFailure('CONFLICT');
            }
            const acknowledgedDraft = input.draftAck
              ? await verifyDraftAcknowledgement(database, input.draftAck, durableGenerationsFor(input.draftAck), {
                clientId: input.clientId, kind: 'contact', recordId: input.id,
                baseRevision: input.expectedRevision, value: validation.value,
              })
              : null;
            if (input.draftAck && isAcknowledgementDiscarded(input.draftAck)) {
              throw new RecordFailure('CONFLICT');
            }
            const now = checkedTime(clock);
            await ensureProfile(database, client, now);
            if (input.draftAck && isAcknowledgementDiscarded(input.draftAck)) {
              throw new RecordFailure('CONFLICT');
            }
            const next: ClientContact = {
              id: input.id,
              clientId: input.clientId,
              ...validation.value,
              revision: current ? incrementRevision(current.revision) : 1,
              createdAt: current?.createdAt ?? now,
              updatedAt: now,
            };
            await database.clientContacts.put(next);
            if (input.draftAck && isAcknowledgementDiscarded(input.draftAck)) {
              throw new RecordFailure('CONFLICT');
            }
            if (acknowledgedDraft && input.draftAck) {
              await finishDraftAcknowledgement(database, acknowledgedDraft, input.draftAck.generation,
                next.revision, now);
            }
            if (input.draftAck && isAcknowledgementDiscarded(input.draftAck)) {
              throw new RecordFailure('CONFLICT');
            }
            return next;
          },
        );
        if (input.draftAck) forgetAcknowledgedGenerations(input.draftAck);
        return { ok: true, value: cloneContact(contact) };
      } catch (error) {
        return resultFailure(error);
      }
    },
    setPrimaryContact: async (input: {
      clientId: string;
      contactId: string | null;
      expectedProfileRevision: number | null;
    }): Promise<ClientRecordResult<ClientProfile>> => {
      if (!input || !validId(input.clientId)) return { ok: false, code: 'VALIDATION', field: 'clientId' };
      if (input.contactId !== null && !validId(input.contactId)) {
        return { ok: false, code: 'VALIDATION', field: 'contactId' };
      }
      if (!validRevision(input.expectedProfileRevision)) {
        return { ok: false, code: 'VALIDATION', field: 'expectedProfileRevision' };
      }
      try {
        const profile = await database.transaction(
          'rw', database.clients, database.clientProfiles, database.clientContacts, async () => {
            const client = validOwner(await database.clients.get(input.clientId), input.clientId);
            const current = await database.clientProfiles.get(input.clientId);
            if (current && current.clientId !== input.clientId) throw new RecordFailure('STORAGE');
            checkExpectedRevision(current, input.expectedProfileRevision);
            if (input.contactId !== null) {
              const contact = await database.clientContacts.get(input.contactId);
              if (!contact) throw new RecordFailure('NOT_FOUND');
              if (contact.clientId !== input.clientId) throw new RecordFailure('CONFLICT');
              if (contact.deletedAt !== undefined) throw new RecordFailure('NOT_FOUND');
            }
            const now = checkedTime(clock);
            const next: ClientProfile = current ? {
              ...current,
              clientSnapshot: cloneClient(client),
              primaryContactId: input.contactId,
              revision: incrementRevision(current.revision),
              updatedAt: now,
            } : {
              clientId: input.clientId,
              clientSnapshot: cloneClient(client),
              website: '',
              description: '',
              primaryContactId: input.contactId,
              revision: 1,
              updatedAt: now,
            };
            await database.clientProfiles.put(next);
            return next;
          },
        );
        return { ok: true, value: cloneProfile(profile) };
      } catch (error) {
        return resultFailure(error);
      }
    },
    deleteContact: async (input: {
      id: string;
      clientId: string;
      expectedRevision: number;
    }): Promise<ClientRecordResult<ClientContact>> => {
      if (!input || !validId(input.id)) return { ok: false, code: 'VALIDATION', field: 'id' };
      if (!validId(input.clientId)) return { ok: false, code: 'VALIDATION', field: 'clientId' };
      if (!validCurrentRevision(input.expectedRevision)) {
        return { ok: false, code: 'VALIDATION', field: 'expectedRevision' };
      }
      try {
        const contact = await database.transaction(
          'rw', database.clients, database.clientProfiles, database.clientContacts, async () => {
            const client = validOwner(await database.clients.get(input.clientId), input.clientId);
            const current = await database.clientContacts.get(input.id);
            if (!current) throw new RecordFailure('NOT_FOUND');
            if (current.clientId !== input.clientId) throw new RecordFailure('CONFLICT');
            if (current.deletedAt !== undefined) throw new RecordFailure('NOT_FOUND');
            checkExpectedRevision(current, input.expectedRevision);
            const now = checkedTime(clock);
            const next: ClientContact = {
              ...current,
              revision: incrementRevision(current.revision),
              updatedAt: now,
              deletedAt: now,
            };
            await database.clientContacts.put(next);
            const profile = await database.clientProfiles.get(input.clientId);
            if (profile?.primaryContactId === input.id) {
              validateStoredRevision(profile.revision);
              const updated = await database.clientProfiles.update(input.clientId, {
                clientSnapshot: cloneClient(client),
                primaryContactId: null,
                revision: incrementRevision(profile.revision),
                updatedAt: now,
              });
              if (updated !== 1) throw new RecordFailure('STORAGE');
            }
            return next;
          },
        );
        return { ok: true, value: cloneContact(contact) };
      } catch (error) {
        return resultFailure(error);
      }
    },
    listNotes: async (input: {
      clientId: string | null;
      deleted: boolean;
      archived: boolean;
      query: string;
    }): Promise<ClientRecordResult<ClientNote[]>> => {
      if (!input || (input.clientId !== null && !validId(input.clientId))) {
        return { ok: false, code: 'VALIDATION', field: 'clientId' };
      }
      if (typeof input.deleted !== 'boolean' || typeof input.archived !== 'boolean') {
        return { ok: false, code: 'VALIDATION', field: 'filter' };
      }
      if (typeof input.query !== 'string') return { ok: false, code: 'VALIDATION', field: 'query' };
      try {
        const notes = await database.clientNotes.toArray();
        const liveClientIds = new Set((await database.clients.toArray()).map((client) => client.id));
        const query = input.query.toLowerCase();
        const filtered = notes.filter((note) => {
          if (input.clientId !== null && note.clientId !== input.clientId) return false;
          if ((note.deletedAt !== undefined) !== input.deleted) return false;
          if (liveClientIds.has(note.clientId) === input.archived) return false;
          if (query && !`${note.title}\n${note.bodyText}`.toLowerCase().includes(query)) return false;
          return true;
        });
        filtered.sort((left, right) => right.occurredAt - left.occurredAt || compareText(left.id, right.id));
        return { ok: true, value: filtered.map(cloneNote) };
      } catch {
        return { ok: false, code: 'STORAGE' };
      }
    },
    saveNote: async (input: {
      id: string;
      clientId: string;
      expectedRevision: number | null;
      value: NoteDraftValue;
      draftId: string | null;
      generation: number | null;
      editSessionId: string | null;
    }): Promise<ClientRecordResult<ClientNote>> => {
      if (!input || !validId(input.id)) return { ok: false, code: 'VALIDATION', field: 'id' };
      if (!validId(input.clientId)) return { ok: false, code: 'VALIDATION', field: 'clientId' };
      if (!validRevision(input.expectedRevision)) {
        return { ok: false, code: 'VALIDATION', field: 'expectedRevision' };
      }
      if (input.draftId === null) {
        if (input.generation !== null) return { ok: false, code: 'VALIDATION', field: 'draftId' };
        if (input.editSessionId !== null) return { ok: false, code: 'VALIDATION', field: 'editSessionId' };
      } else {
        if (!validId(input.draftId)) return { ok: false, code: 'VALIDATION', field: 'draftId' };
        if (!validGeneration(input.generation)) return { ok: false, code: 'VALIDATION', field: 'generation' };
        if (!validId(input.editSessionId)) return { ok: false, code: 'VALIDATION', field: 'editSessionId' };
      }
      const validation = validateNote(input.value);
      if (!validation.ok) return validation;
      if (validation.value.contactId !== null && !validId(validation.value.contactId)) {
        return { ok: false, code: 'VALIDATION', field: 'contactId' };
      }
      const draftSession = input.draftId !== null && input.editSessionId !== null
        ? draftSessionKey(input.draftId, input.editSessionId)
        : null;
      const assertDraftSessionNotDiscarded = (): void => {
        if (draftSession && runtime.discardedSessions.has(draftSession)) {
          throw new RecordFailure('CONFLICT');
        }
      };
      try {
        const note = await database.transaction(
          'rw', [database.clients, database.clientProfiles, database.clientContacts,
            database.clientNotes, database.clientDrafts, database.clientAttachments, database.settings],
          async () => {
            assertDraftSessionNotDiscarded();
            const client = validOwner(await database.clients.get(input.clientId), input.clientId);
            const current = await database.clientNotes.get(input.id);
            if (current && current.clientId !== input.clientId) throw new RecordFailure('CONFLICT');
            if (current?.deletedAt !== undefined) throw new RecordFailure('NOT_FOUND');
            checkExpectedRevision(current, input.expectedRevision);

            let matchedDraft: ClientDraft | undefined;
            if (input.draftId !== null) {
              const draft = await database.clientDrafts.get(input.draftId);
              if (!draft || !validId(draft.id) || draft.id !== input.draftId
                || !validId(draft.clientId) || draft.kind !== 'note' || draft.clientId !== input.clientId
                || !validId(draft.recordId)
                || draft.recordId !== input.id || draft.generation !== input.generation
                || draft.baseRevision !== input.expectedRevision || !validId(draft.editSessionId)
                || draft.editSessionId !== input.editSessionId) {
                throw new RecordFailure('CONFLICT');
              }
              const draftValue = validateNote(draft.value);
              if (!draftValue.ok || !noteDraftEqualsValue({ ...draft, value: draftValue.value }, validation.value)) {
                throw new RecordFailure('CONFLICT');
              }
              matchedDraft = draft;
            }
            assertDraftSessionNotDiscarded();

            let contactSnapshot: ClientNote['contactSnapshot'];
            if (current && current.contactId === validation.value.contactId) {
              contactSnapshot = current.contactSnapshot ? { ...current.contactSnapshot } : null;
            } else if (validation.value.contactId === null) {
              contactSnapshot = null;
            } else {
              const contact = await database.clientContacts.get(validation.value.contactId);
              if (!contact) throw new RecordFailure('NOT_FOUND');
              if (contact.clientId !== input.clientId) throw new RecordFailure('CONFLICT');
              if (contact.deletedAt !== undefined) throw new RecordFailure('NOT_FOUND');
              contactSnapshot = { name: contact.name, email: contact.email };
            }

            const noteAttachments = await database.clientAttachments
              .where('[ownerType+ownerId]').equals(['note', input.id]).toArray();
            const draftAttachments = matchedDraft
              ? await database.clientAttachments.where('[ownerType+ownerId]')
                .equals(['draft', matchedDraft.id]).toArray()
              : [];
            for (const attachment of [...noteAttachments, ...draftAttachments]) {
              if (attachment.clientId !== input.clientId
                || attachment.ownerType !== (draftAttachments.includes(attachment) ? 'draft' : 'note')
                || (attachment.ownerType === 'draft' && attachment.ownerId !== matchedDraft?.id)
                || (attachment.ownerType === 'note' && attachment.ownerId !== input.id)) {
                throw new RecordFailure('CONFLICT');
              }
              if (!Number.isSafeInteger(attachment.bytes) || attachment.bytes < 0
                || attachment.bytes > MAX_ATTACHMENT_BYTES || attachment.data.size !== attachment.bytes) {
                throw new RecordFailure('STORAGE');
              }
            }
            if (noteAttachments.length + draftAttachments.length > MAX_ATTACHMENTS_PER_OWNER) {
              throw new RecordFailure('LIMIT', 'attachments');
            }

            const now = checkedTime(clock);
            assertDraftSessionNotDiscarded();
            await ensureProfile(database, client, now);
            assertDraftSessionNotDiscarded();
            const actorSetting = await database.settings.get(CLIENTS_ACTOR_KEY);
            const actorId = typeof actorSetting?.value === 'string' && validId(actorSetting.value)
              ? actorSetting.value
              : nanoid();
            if (actorId !== actorSetting?.value) {
              await database.settings.put({ key: CLIENTS_ACTOR_KEY, value: actorId });
            }
            assertDraftSessionNotDiscarded();
            const next: ClientNote = {
              id: input.id,
              clientId: input.clientId,
              ...validation.value,
              contactSnapshot,
              pinned: current?.pinned ?? false,
              authorId: current?.authorId ?? actorId,
              revision: current ? incrementRevision(current.revision) : 1,
              createdAt: current?.createdAt ?? now,
              updatedAt: now,
            };
            await database.clientNotes.put(next);
            for (const attachment of draftAttachments) {
              await database.clientAttachments.put({ ...attachment, ownerType: 'note', ownerId: input.id });
            }
            if (matchedDraft) await database.clientDrafts.delete(matchedDraft.id);
            assertDraftSessionNotDiscarded();
            return next;
          },
        );
        return { ok: true, value: cloneNote(note) };
      } catch (error) {
        return resultFailure(error);
      }
    },
    setNotePinned: async (input: {
      id: string;
      clientId: string;
      expectedRevision: number;
      pinned: boolean;
    }): Promise<ClientRecordResult<ClientNote>> => {
      if (!input || !validId(input.id)) return { ok: false, code: 'VALIDATION', field: 'id' };
      if (!validId(input.clientId)) return { ok: false, code: 'VALIDATION', field: 'clientId' };
      if (!validCurrentRevision(input.expectedRevision)) {
        return { ok: false, code: 'VALIDATION', field: 'expectedRevision' };
      }
      if (typeof input.pinned !== 'boolean') return { ok: false, code: 'VALIDATION', field: 'pinned' };
      try {
        const note = await database.transaction('rw', database.clients, database.clientNotes, async () => {
          validOwner(await database.clients.get(input.clientId), input.clientId);
          const current = await database.clientNotes.get(input.id);
          if (!current) throw new RecordFailure('NOT_FOUND');
          if (current.clientId !== input.clientId) throw new RecordFailure('CONFLICT');
          if (current.deletedAt !== undefined) throw new RecordFailure('NOT_FOUND');
          checkExpectedRevision(current, input.expectedRevision);
          const next: ClientNote = {
            ...current,
            pinned: input.pinned,
            revision: incrementRevision(current.revision),
            updatedAt: checkedTime(clock),
          };
          await database.clientNotes.put(next);
          return next;
        });
        return { ok: true, value: cloneNote(note) };
      } catch (error) {
        return resultFailure(error);
      }
    },
    setNoteDeleted: async (input: {
      id: string;
      clientId: string;
      expectedRevision: number;
      deleted: boolean;
    }): Promise<ClientRecordResult<ClientNote>> => {
      if (!input || !validId(input.id)) return { ok: false, code: 'VALIDATION', field: 'id' };
      if (!validId(input.clientId)) return { ok: false, code: 'VALIDATION', field: 'clientId' };
      if (!validCurrentRevision(input.expectedRevision)) {
        return { ok: false, code: 'VALIDATION', field: 'expectedRevision' };
      }
      if (typeof input.deleted !== 'boolean') return { ok: false, code: 'VALIDATION', field: 'deleted' };
      try {
        const note = await database.transaction('rw', database.clients, database.clientNotes, async () => {
          validOwner(await database.clients.get(input.clientId), input.clientId);
          const current = await database.clientNotes.get(input.id);
          if (!current) throw new RecordFailure('NOT_FOUND');
          if (current.clientId !== input.clientId) throw new RecordFailure('CONFLICT');
          checkExpectedRevision(current, input.expectedRevision);
          const isDeleted = current.deletedAt !== undefined;
          if (isDeleted === input.deleted) return current;
          const next: ClientNote = {
            ...current,
            revision: incrementRevision(current.revision),
            updatedAt: checkedTime(clock),
          };
          if (input.deleted) next.deletedAt = next.updatedAt;
          else delete next.deletedAt;
          await database.clientNotes.put(next);
          return next;
        });
        return { ok: true, value: cloneNote(note) };
      } catch (error) {
        return resultFailure(error);
      }
    },
    saveDraft: async (draft: ClientDraft): Promise<ClientRecordResult<ClientDraft>> => {
      const validation = validateDraft(draft);
      if (!validation.ok) return validation;
      const nextDraft = validation.value;
      if (nextDraft.kind === 'profile' && nextDraft.recordId !== nextDraft.clientId) {
        return { ok: false, code: 'VALIDATION', field: 'recordId' };
      }
      try {
        const saved = await database.transaction(
          'rw', database.clients, database.clientProfiles, database.clientContacts,
          database.clientNotes, database.clientDrafts, async () => {
            return persistDraft(database, nextDraft, clock, isDraftDiscarded);
          },
        );
        rememberDraftGeneration(saved);
        return { ok: true, value: cloneDraft(saved) };
      } catch (error) {
        return resultFailure(error);
      }
    },
    getDraft: async (id: string): Promise<ClientRecordResult<ClientDraft | null>> => {
      if (!validId(id)) return { ok: false, code: 'VALIDATION', field: 'id' };
      try {
        const draft = await database.clientDrafts.get(id);
        return { ok: true, value: draft ? cloneDraft(draft) : null };
      } catch {
        return { ok: false, code: 'STORAGE' };
      }
    },
    discardDraft: async (input: {
      id: string;
      editSessionId: string;
      generation: number;
    }): Promise<ClientRecordResult<void>> => {
      if (!input || !validId(input.id)) return { ok: false, code: 'VALIDATION', field: 'id' };
      if (!validId(input.editSessionId)) return { ok: false, code: 'VALIDATION', field: 'editSessionId' };
      if (!validGeneration(input.generation)) return { ok: false, code: 'VALIDATION', field: 'generation' };
      const sessionKey = draftSessionKey(input.id, input.editSessionId);
      const cancellation = runtime.discardedSessions.get(sessionKey)
        ?? { attempts: new Set<symbol>(), succeeded: false };
      const attempt = Symbol();
      cancellation.attempts.add(attempt);
      runtime.discardedSessions.set(sessionKey, cancellation);
      try {
        await database.transaction('rw', database.clientDrafts, database.clientAttachments, async () => {
          const draft = await database.clientDrafts.get(input.id);
          if (!draft) return;
          if (draft.editSessionId !== input.editSessionId || draft.generation !== input.generation) {
            throw new RecordFailure('CONFLICT');
          }
          const attachments = await database.clientAttachments.where('[ownerType+ownerId]')
            .equals(['draft', input.id]).toArray();
          if (attachments.some((attachment) => attachment.clientId !== draft.clientId
            || attachment.ownerType !== 'draft' || attachment.ownerId !== input.id)) {
            throw new RecordFailure('CONFLICT');
          }
          await database.clientAttachments.bulkDelete(attachments.map((attachment) => attachment.id));
          await database.clientDrafts.delete(input.id);
        });
        cancellation.succeeded = true;
        forgetDraftSession(input.id, input.editSessionId);
        return { ok: true, value: undefined };
      } catch (error) {
        return resultFailure(error);
      } finally {
        cancellation.attempts.delete(attempt);
        if (!cancellation.succeeded && cancellation.attempts.size === 0
          && runtime.discardedSessions.get(sessionKey) === cancellation) {
          runtime.discardedSessions.delete(sessionKey);
        }
      }
    },
    addAttachment: async (input: {
      id: string;
      clientId: string;
      ownerType: 'note' | 'draft';
      ownerId: string;
      file: File;
      draft?: ClientDraft;
    }): Promise<ClientRecordResult<ClientAttachment>> => {
      if (!input || !validId(input.id)) return { ok: false, code: 'VALIDATION', field: 'id' };
      if (!validId(input.clientId)) return { ok: false, code: 'VALIDATION', field: 'clientId' };
      if (input.ownerType !== 'note' && input.ownerType !== 'draft') {
        return { ok: false, code: 'VALIDATION', field: 'ownerType' };
      }
      if (!validId(input.ownerId)) return { ok: false, code: 'VALIDATION', field: 'ownerId' };
      let draftSeed: ClientDraft | undefined;
      if (input.draft !== undefined) {
        const validation = validateDraft(input.draft);
        if (!validation.ok) return validation;
        draftSeed = validation.value;
        if (draftSeed.kind !== 'note') return { ok: false, code: 'VALIDATION', field: 'draft' };
        if (input.ownerType !== 'draft' || draftSeed.id !== input.ownerId
          || draftSeed.clientId !== input.clientId) {
          return { ok: false, code: 'CONFLICT' };
        }
        if (isDraftDiscarded(draftSeed)) return { ok: false, code: 'CONFLICT' };
      }
      const id = input.id;
      const clientId = input.clientId;
      const ownerType = input.ownerType;
      const ownerId = input.ownerId;
      let prepared: Awaited<ReturnType<typeof prepareAttachment>>;
      try {
        prepared = await prepareAttachment(input.file);
      } catch (error) {
        return resultFailure(error);
      }

      const metadata = {
        id, clientId, ownerType, ownerId,
        displayName: prepared.displayName, mime: prepared.mime, bytes: prepared.bytes,
      };
      try {
        const prior = await database.transaction(
          'r', [database.clients, database.clientNotes, database.clientDrafts, database.clientAttachments],
          async () => {
            const client = validOwner(await database.clients.get(clientId), clientId);
            let draft: ClientDraft | undefined;
            if (ownerType === 'note') {
              const note = await database.clientNotes.get(ownerId);
              if (!note) throw new RecordFailure('NOT_FOUND');
              if (note.clientId !== client.id) throw new RecordFailure('CONFLICT');
              if (note.deletedAt !== undefined) throw new RecordFailure('NOT_FOUND');
            } else {
              draft = await database.clientDrafts.get(ownerId);
              if (!draft && !draftSeed) throw new RecordFailure('NOT_FOUND');
              if (draft && draft.clientId !== clientId) throw new RecordFailure('CONFLICT');
              if (draftSeed && draft && (draft.id !== draftSeed.id || draft.clientId !== draftSeed.clientId
                || draft.kind !== draftSeed.kind || draft.recordId !== draftSeed.recordId
                || draft.editSessionId !== draftSeed.editSessionId)) {
                throw new RecordFailure('CONFLICT');
              }
            }
            const attachment = await database.clientAttachments.get(id);
            if (!attachment) return null;
            if (!sameAttachmentMetadata(attachment, metadata)) throw new RecordFailure('CONFLICT');
            validateStoredAttachment(attachment);
            return { attachment, draft };
          },
        );
        if (prior) {
          if (!await sameBlob(prior.attachment.data, prepared.data)) throw new RecordFailure('CONFLICT');
          if (draftSeed && (!prior.draft || !sameDraftContent(prior.draft, draftSeed))) {
            throw new RecordFailure('CONFLICT');
          }
          return { ok: true, value: cloneAttachment(prior.attachment) };
        }

        const outcome = await database.transaction(
          'rw', [database.clients, database.clientProfiles, database.clientContacts,
            database.clientNotes, database.clientDrafts, database.clientAttachments], async () => {
            const client = validOwner(await database.clients.get(clientId), clientId);
            let existingDraft: ClientDraft | undefined;
            if (ownerType === 'note') {
              const note = await database.clientNotes.get(ownerId);
              if (!note) throw new RecordFailure('NOT_FOUND');
              if (note.clientId !== clientId) throw new RecordFailure('CONFLICT');
              if (note.deletedAt !== undefined) throw new RecordFailure('NOT_FOUND');
            } else {
              existingDraft = await database.clientDrafts.get(ownerId);
              if (!existingDraft && !draftSeed) throw new RecordFailure('NOT_FOUND');
              if (existingDraft && existingDraft.clientId !== clientId) throw new RecordFailure('CONFLICT');
            }
            const existing = await database.clientAttachments.get(id);
            if (existing) {
              if (!sameAttachmentMetadata(existing, metadata)) throw new RecordFailure('CONFLICT');
              validateStoredAttachment(existing);
              if (draftSeed && (!existingDraft || !sameDraftContent(existingDraft, draftSeed))) {
                throw new RecordFailure('CONFLICT');
              }
              return { attachment: existing, existing: true };
            }
            if (ownerType === 'draft' && draftSeed) {
              const storedDraft = await persistDraft(database, draftSeed, clock, isDraftDiscarded);
              if (storedDraft.id !== ownerId || storedDraft.clientId !== clientId) {
                throw new RecordFailure('CONFLICT');
              }
            }
            const owned = await database.clientAttachments.where('[ownerType+ownerId]')
              .equals([ownerType, ownerId]).toArray();
            if (owned.some((row) => row.clientId !== clientId
              || row.ownerType !== ownerType || row.ownerId !== ownerId)) {
              throw new RecordFailure('CONFLICT');
            }
            if (owned.length >= MAX_ATTACHMENTS_PER_OWNER) throw new RecordFailure('LIMIT', 'attachments');
            const next: ClientAttachment = {
              id,
              clientId: client.id,
              ownerType,
              ownerId,
              displayName: prepared.displayName,
              mime: prepared.mime,
              bytes: prepared.bytes,
              data: prepared.data,
              createdAt: checkedTime(clock),
            };
            await database.clientAttachments.add(next);
            return { attachment: next, existing: false };
          },
        );
        // Retry identity is the immutable row snapshot read without mutation; all Blob reads stay
        // outside IndexedDB transactions, and failed comparisons cannot commit draft seeds.
        if (outcome.existing) {
          if (!await sameBlob(outcome.attachment.data, prepared.data)) throw new RecordFailure('CONFLICT');
        }
        return { ok: true, value: cloneAttachment(outcome.attachment) };
      } catch (error) {
        return resultFailure(error);
      }
    },
    listAttachments: async (input: {
      ownerType: 'note' | 'draft';
      ownerId: string;
    }): Promise<ClientRecordResult<ClientAttachment[]>> => {
      if (!input || (input.ownerType !== 'note' && input.ownerType !== 'draft')) {
        return { ok: false, code: 'VALIDATION', field: 'ownerType' };
      }
      if (!validId(input.ownerId)) return { ok: false, code: 'VALIDATION', field: 'ownerId' };
      try {
        const attachments = await database.transaction(
          'r', database.clientNotes, database.clientDrafts, database.clientAttachments, async () => {
            const owner = input.ownerType === 'note'
              ? await database.clientNotes.get(input.ownerId)
              : await database.clientDrafts.get(input.ownerId);
            if (!owner) throw new RecordFailure('NOT_FOUND');
            const rows = await database.clientAttachments.where('[ownerType+ownerId]')
              .equals([input.ownerType, input.ownerId]).toArray();
            if (rows.some((row) => row.clientId !== owner.clientId
              || row.ownerType !== input.ownerType || row.ownerId !== input.ownerId)) {
              throw new RecordFailure('CONFLICT');
            }
            return rows;
          },
        );
        attachments.sort((left, right) => left.createdAt - right.createdAt || compareText(left.id, right.id));
        return { ok: true, value: attachments.map(cloneAttachment) };
      } catch (error) {
        return resultFailure(error);
      }
    },
    removeAttachment: async (input: {
      id: string;
      clientId: string;
      ownerType: 'note' | 'draft';
      ownerId: string;
    }): Promise<ClientRecordResult<void>> => {
      if (!input || !validId(input.id)) return { ok: false, code: 'VALIDATION', field: 'id' };
      if (!validId(input.clientId)) return { ok: false, code: 'VALIDATION', field: 'clientId' };
      if (input.ownerType !== 'note' && input.ownerType !== 'draft') {
        return { ok: false, code: 'VALIDATION', field: 'ownerType' };
      }
      if (!validId(input.ownerId)) return { ok: false, code: 'VALIDATION', field: 'ownerId' };
      try {
        await database.transaction(
          'rw', database.clients, database.clientNotes, database.clientDrafts, database.clientAttachments,
          async () => {
            validOwner(await database.clients.get(input.clientId), input.clientId);
            const owner = input.ownerType === 'note'
              ? await database.clientNotes.get(input.ownerId)
              : await database.clientDrafts.get(input.ownerId);
            if (!owner) throw new RecordFailure('NOT_FOUND');
            if (owner.clientId !== input.clientId) throw new RecordFailure('CONFLICT');
            const attachment = await database.clientAttachments.get(input.id);
            if (!attachment) return;
            if (attachment.clientId !== input.clientId || attachment.ownerType !== input.ownerType
              || attachment.ownerId !== input.ownerId) throw new RecordFailure('CONFLICT');
            await database.clientAttachments.delete(input.id);
          },
        );
        return { ok: true, value: undefined };
      } catch (error) {
        return resultFailure(error);
      }
    },
  };
}
