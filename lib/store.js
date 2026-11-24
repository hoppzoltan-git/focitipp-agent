import { put, head } from '@vercel/blob';

const FILES = { current: 'data/matchday-current.json', stats: 'data/matchday-stats.json' };

export async function readDoc(name) {
  try {
    const meta = await head(FILES[name]);
    const r = await fetch(`${meta.url}?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null; // még nincs ilyen fájl
  }
}

export async function writeDoc(name, data) {
  await put(FILES[name], JSON.stringify(data), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 60,
  });
}
