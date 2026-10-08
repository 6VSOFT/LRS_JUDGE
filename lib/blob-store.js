// Some SDK versions report modified=true with an empty ETag on failed HTTP writes.
// Only acknowledge provider-confirmed writes; the room request retries everything else.
export function createRoomStore(blobs) {
  return {
    read: key => blobs.getWithMetadata(key, { type: 'json', consistency: 'strong' }),
    async write(key, data, etag) {
      const result = await blobs.setJSON(key, data, etag === undefined ? { onlyIfNew: true } : { onlyIfMatch: etag });
      return result.modified === true && typeof result.etag === 'string' && result.etag.length > 0;
    },
  };
}
