import type { Client } from './index';

export type ClientCategory = 'overview' | 'profile' | 'notes';
export type ClientNoteKind = 'call' | 'meeting' | 'decision' | 'note';
export type ClientRecordErrorCode =
  | 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT' | 'DETACHED'
  | 'STORAGE' | 'LIMIT';
export type ClientRecordResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: ClientRecordErrorCode; field?: string };

export interface ClientProfile {
  clientId: string;
  clientSnapshot: Client;
  website: string;
  description: string;
  primaryContactId: string | null;
  revision: number;
  updatedAt: number;
}

export interface ClientContact {
  id: string;
  clientId: string;
  name: string;
  role: string;
  email: string;
  phone: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

export interface ClientNote {
  id: string;
  clientId: string;
  title: string;
  bodyText: string;
  kind: ClientNoteKind;
  occurredAt: number;
  contactId: string | null;
  contactSnapshot: { name: string; email: string } | null;
  pinned: boolean;
  authorId: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

export interface ProfileDraftValue {
  website: string;
  description: string;
}

export interface ContactDraftValue {
  name: string;
  role: string;
  email: string;
  phone: string;
}

export interface NoteDraftValue {
  title: string;
  bodyText: string;
  kind: ClientNoteKind;
  occurredAt: number;
  contactId: string | null;
}

interface DraftBase {
  id: string;
  clientId: string;
  editSessionId: string;
  generation: number;
  baseRevision: number | null;
  updatedAt: number;
}

export type ClientDraft = DraftBase & (
  | { kind: 'profile'; recordId: string; value: ProfileDraftValue }
  | { kind: 'contact'; recordId: string; value: ContactDraftValue }
  | { kind: 'note'; recordId: string; value: NoteDraftValue }
);

export interface ClientAttachment {
  id: string;
  clientId: string;
  ownerType: 'note' | 'draft';
  ownerId: string;
  displayName: string;
  mime: string;
  bytes: number;
  data: Blob;
  createdAt: number;
}
