export class MemoryStore {
  entries = new Map();
  revision = 0;

  async read(key) {
    const entry = this.entries.get(key);
    return entry ? structuredClone(entry) : null;
  }

  async write(key, data, etag) {
    const current = this.entries.get(key);
    if (etag === undefined ? current !== undefined : current?.etag !== etag) return false;
    this.entries.set(key, { data: structuredClone(data), etag: String(++this.revision) });
    return true;
  }
}
