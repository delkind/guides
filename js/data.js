// Site data: js/tours.json and each tour's <id>/js/data.js. URLs are relative to the shell at the site root.
let catalogueP = null;
const stopsP = new Map();

async function get(url, as) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r[as]();
}

export function catalogue() {
  catalogueP ??= get('js/tours.json', 'json').catch(e => {
    catalogueP = null;
    throw e;
  });
  return catalogueP;
}

export async function tour(id) {
  return (await catalogue()).find(t => t.id === id) ?? null;
}

/** data.js is `const stops = [...];`: parse the slice from the first '[' to the last ']', as Android's TourParser does. */
export function parseStops(text) {
  return JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1));
}

export function stops(id) {
  if (!stopsP.has(id)) {
    stopsP.set(id, get(`${encodeURIComponent(id)}/js/data.js`, 'text').then(parseStops).catch(e => {
      stopsP.delete(id);
      throw e;
    }));
  }
  return stopsP.get(id);
}

export const mediaUrl = (id, rel) => `${id}/${rel}`;

export const coverUrl = t => t?.cover?.src ?? null;
