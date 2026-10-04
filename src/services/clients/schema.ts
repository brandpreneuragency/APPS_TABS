export const CLIENTS_V1_STORES = {
  clientProfiles: 'clientId, updatedAt',
  clientContacts: 'id, clientId, [clientId+deletedAt], updatedAt',
  clientNotes: 'id, clientId, [clientId+occurredAt], updatedAt, deletedAt',
  clientDrafts: 'id, clientId, [clientId+kind], updatedAt',
  clientAttachments: 'id, clientId, [ownerType+ownerId]',
} as const;

export const CLIENTS_ACTOR_KEY = 'clientsV1Actor';
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_OWNER = 5;
