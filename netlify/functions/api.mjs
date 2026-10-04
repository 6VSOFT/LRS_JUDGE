import { getStore } from '@netlify/blobs';
import { handleRequest } from '../../lib/rooms.js';

export default async function api(request) {
  const blobs = getStore({ name: 'lrs-rooms-v1', consistency: 'strong' });
  const store = {
    read: key => blobs.getWithMetadata(key, { type: 'json', consistency: 'strong' }),
    async write(key, data, etag) {
      const { modified } = await blobs.setJSON(key, data, etag === undefined ? { onlyIfNew: true } : { onlyIfMatch: etag });
      return modified;
    },
  };
  return handleRequest(request, store);
}

export const config = { path: '/api/*' };
