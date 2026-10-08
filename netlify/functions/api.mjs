import { getStore } from '@netlify/blobs';
import { handleRequest } from '../../lib/rooms.js';
import { createRoomStore } from '../../lib/blob-store.js';

export default async function api(request) {
  const blobs = getStore({ name: 'lrs-rooms-v1', consistency: 'strong' });
  const store = createRoomStore(blobs);
  return handleRequest(request, store);
}

export const config = { path: '/api/*' };
