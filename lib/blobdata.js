import { put, head, list, del } from '@vercel/blob';

export async function readBlobJson(path) {
  try {
    const meta = await head(path);
    const r = await fetch(`${meta.url}?t=${Date.now()}`, { cache: 'no-store' });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

export const writeBlob = (path, body, type = 'application/json') =>
  put(path, body, { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: type, cacheControlMaxAge: 60 });

export async function listPrefix(prefix) {
  const out = [];
  let cursor;
  do {
    const r = await list({ prefix, cursor });
    out.push(...r.blobs);
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return out;
}

export async function deletePrefix(prefix) {
  const blobs = await listPrefix(prefix);
  if (blobs.length) await del(blobs.map((b) => b.url));
}
