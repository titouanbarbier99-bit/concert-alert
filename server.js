const express = require('express');const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');


const app = express();
const PORT = process.env.PORT || 3000;


const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const TICKETMASTER_KEY = process.env.TICKETMASTER_API_KEY || 'lmSBuxsZpv2SuSIxH6mHowsuNuteTr7s';
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';

const GEMINI_DEFAULT = 'gemini-3.8-flash';
const GEMINI_FALLBACKS = ['gemini-3.8-flash','gemini-3.7-flash','gemini-3.6-flash','gemini-3.5-flash','gemini-3.1-flash-lite','gemini-2.5-flash'];
let GEMINI_MODEL = process.env.GEMINI_MODEL || GEMINI_DEFAULT;
let GEMINI_MODEL_LOCKED = !!process.env.GEMINI_MODEL;

const TM_TIMEOUT = 20000;
const GEMINI_TIMEOUT = 60000;
const GENRE_TTL = 6 * 60 * 60 * 1000;


const FAMOUS_FALLBACK = ["Taylor Swift","Coldplay","Ed Sheeran","Beyonce","Drake","Rihanna","Bruno Mars","Adele","The Weeknd","Dua Lipa"];
const TOP_WORLD = ["Taylor Swift","Coldplay","Ed Sheeran","Beyonce","Drake","Rihanna","Bruno Mars","Adele","The Weeknd","Dua Lipa","Billie Eilish","Post Malone","Travis Scott","Kendrick Lamar","Bad Bunny","David Guetta","Calvin Harris","Imagine Dragons","Maroon 5","Metallica","U2","Arctic Monkeys","Gims","SCH","Ninho","Damso","Booba","Aya Nakamura","PNL","Orelsan","Shakira","Justin Bieber","Lady Gaga"];


let topWorldCache = { data: null, time: 0 };
const userSessions = new Map();
const currentState = new Map();
const genreCache = new Map();
let discoverCache = { key: '', data: [], time: 0 };
let lastGoodModel = '';


app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));


function postForm(url, params) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = new URLSearchParams(params).toString();
    const options = { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }, timeout: 20000 };
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(new Error(data)); } });
    });
    req.on('timeout', () => req.destroy(new Error('Timeout Spotify')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
function get(url, accessToken) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const options = { method: 'GET', headers: {}, timeout: TM_TIMEOUT };
    if (accessToken) options.headers.Authorization = 'Bearer ' + accessToken;
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (res.statusCode >= 400) { reject(Object.assign(new Error('API error ' + res.statusCode), { body: j })); }
          else resolve(j);
        } catch (e) { reject(new Error(data)); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Timeout API')));
    req.on('error', reject);
    req.end();
  });
}
function normalizeArtist(name) {
  return (name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}
function artistMatches(name, event) {
  const target = normalizeArtist(name);
  const att = normalizeArtist(event.artist || '');
  if (att && att === target) return true;
  return false;
}
function isUpcoming(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  return !isNaN(d) && d.getTime() >= Date.now() - 86400000;
}
app.use((req, res, next) => {
  const header = req.headers.cookie || '';
  const match = header.match(/ca_session=([^;]+)/);
  req.cookies = match ? { ca_session: match[1] } : {};
  next();
});
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/login', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  currentState.set(state, Date.now());
  const scope = 'playlist-read-private user-top-read user-read-recently-played';
  const params = new URLSearchParams({ response_type: 'code', client_id: SPOTIFY_CLIENT_ID, scope, redirect_uri: REDIRECT_URI, state, show_dialog: 'true' });
  res.redirect('https://accounts.spotify.com/authorize?' + params.toString());
});
app.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) { res.status(400).send('Login error: ' + error); return; }
  if (!state || !currentState.has(state)) { res.status(400).send('State mismatch'); return; }
  currentState.delete(state);
  try {
    const token = await postForm('https://accounts.spotify.com/api/token', { grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, client_id: SPOTIFY_CLIENT_ID, client_secret: SPOTIFY_CLIENT_SECRET });
    const tokenId = crypto.randomBytes(24).toString('hex');
    userSessions.set(tokenId, token.access_token);
    res.cookie('ca_session', tokenId, { maxAge: 60 * 60 * 24 * 7 });
    res.redirect('/');
  } catch (e) { res.status(500).send('Login failed: ' + e.message); }
});
app.get('/logout', (req, res) => {
  const id = req.cookies ? req.cookies.ca_session : null;
  if (id && userSessions.has(id)) userSessions.delete(id);
  res.clearCookie('ca_session');
  res.redirect('/');
});
function getToken(req) {
  const id = req.cookies ? req.cookies.ca_session : null;
  if (!id || !userSessions.has(id)) return null;
  return userSessions.get(id);
}
app.get('/api/me', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.json({ authenticated: false });
  try {
    const me = await get('https://api.spotify.com/v1/me', token);
    return res.json({ authenticated: true, id: me.id, display_name: me.display_name });
  } catch (e) { return res.json({ authenticated: false }); }
});
async function getTopArtists(token, limit) {
  try {
    const data = await get('https://api.spotify.com/v1/me/top/artists?limit=' + limit + '&time_range=medium_term', token);
    return (data.items || []).map(a => ({ name: a.name, popularity: a.popularity || null, genres: a.genres || [] }));
  } catch (e) { return []; }
}
app.get('/api/my-artists', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const top = await getTopArtists(token, 50);
    const list = [];
    const seen = new Set();
    const popMap = {};
    const genreMap = {};
    for (const a of top) {
      const key = normalizeArtist(a.name);
      if (!seen.has(key)) { seen.add(key); list.push(a.name); }
      if (a.popularity != null) popMap[a.name] = a.popularity;
      if (a.genres && a.genres.length) genreMap[a.name] = a.genres.slice(0, 3);
    }
    res.json({ artists: list, popMap, genreMap });
  } catch (e) { res.json({ artists: [], popMap: {}, genreMap: {} }); }
});
function mapTmEvent(e) {
  const at = (e._embedded && e._embedded.attractions && e._embedded.attractions[0]) || {};
  return {
    artist: at.name || '',
    genre: (at.classifications && at.classifications[0] && at.classifications[0].name) || (at.primaryClassificationName) || '',
    eventName: e.name || '',
    venue: (e._embedded && e._embedded.venues && e._embedded.venues[0] && e._embedded.venues[0].name) || 'Lieu inconnu',
    city: (e._embedded && e._embedded.venues && e._embedded.venues[0] && e._embedded.venues[0].city && e._embedded.venues[0].city.name) || '',
    country: (e._embedded && e._embedded.venues && e._embedded.venues[0] && e._embedded.venues[0].country && e._embedded.venues[0].country.countryCode) || '',
    date: e.dates && e.dates.start && (e.dates.start.dateTime || e.dates.start.localDate) ? (e.dates.start.dateTime || e.dates.start.localDate) : null,
    url: e.url || '',
    source: 'Ticketmaster'
  };
}
async function findAttraction(name) {
  const target = normalizeArtist(name);
  const tries = [
    'https://app.ticketmaster.com/discovery/v2/attractions.json?apikey=' + TICKETMASTER_KEY + '&keyword=' + encodeURIComponent(name) + '&size=20&locale=fr-fr',
    'https://app.ticketmaster.com/discovery/v2/attractions.json?apikey=' + TICKETMASTER_KEY + '&keyword=' + encodeURIComponent(name) + '&size=20'
  ];
  for (const u of tries) {
    try {
      const data = await get(u);
      const list = (data._embedded && data._embedded.attractions) || [];
      for (const a of list) {
        if (normalizeArtist(a.name) === target) {
          return { id: a.id || null, genre: a.primaryClassificationName || ((a.classifications && a.classifications[0] && a.classifications[0].name) || '') };
        }
      }
    } catch (e) {}
  }
  return { id: null, genre: '' };
}
function cachedGenre(key) {
  const hit = genreCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.t > GENRE_TTL) { genreCache.delete(key); return null; }
  return hit.g;
}
async function getAttractionGenre(name, attId) {
  const key = normalizeArtist(name);
  const hit = cachedGenre(key);
  if (hit !== null) return hit;
  let genre = '';
  try {
    if (attId) {
      const u = 'https://app.ticketmaster.com/discovery/v2/attractions/' + attId + '.json?apikey=' + TICKETMASTER_KEY;
      const data = await get(u);
      genre = (data.primaryClassificationName) || ((data.classifications && data.classifications[0] && data.classifications[0].name) || '');
    }
    if (!genre) {
      const att = await findAttraction(name);
      genre = att.genre || '';
    }
  } catch (e) { genre = ''; }
  genreCache.set(key, { g: genre, t: Date.now() });
  return genre;
}
async function findTicketmasterExact(name) {
  let all = [];
  const att = await findAttraction(name);
  if (att.id) {
    const base = 'https://app.ticketmaster.com/discovery/v2/events.json?apikey=' + TICKETMASTER_KEY + '&attractionId=' + att.id + '&size=50&sort=date,asc';
    for (const u of [base + '&locale=fr-fr', base]) {
      try {
        const data = await get(u);
        const ev = (data._embedded && data._embedded.events) || [];
        all = all.concat(ev.map(mapTmEvent));
      } catch (e) {}
    }
  }
  if (!all.length) {
    const u = 'https://app.ticketmaster.com/discovery/v2/events.json?apikey=' + TICKETMASTER_KEY + '&keyword=' + encodeURIComponent(name) + '&size=50&sort=date,asc&locale=fr-fr';
    try {
      const data = await get(u);
      const ev = (data._embedded && data._embedded.events) || [];
      all = all.concat(ev.map(mapTmEvent));
    } catch (e) {}
  }
  const seen = new Set();
  const uniq = [];
  for (const c of all) {
    const k = (c.url || '') + '|' + (c.date || '');
    if (!seen.has(k)) { seen.add(k); uniq.push(c); }
  }
  const matched = uniq.filter(c => artistMatches(name, c)).filter(c => isUpcoming(c.date));
  matched.sort((a, b) => {
    const aFR = a.country === 'FR' ? 0 : 1;
    const bFR = b.country === 'FR' ? 0 : 1;
    if (aFR !== bFR) return aFR - bFR;
    return new Date(a.date) - new Date(b.date);
  });
  return matched;
}
app.post('/api/multi-artist', async (req, res) => {
  const { artists } = req.body;
  if (!artists || !Array.isArray(artists)) return res.status(400).json({ error: 'Invalid body' });
  const out = [];
  for (const name of artists) {
    const matched = await findTicketmasterExact(name);
    if (!matched.length) { out.push({ name, popularity: null, genre: '', concert: null, concerts: [] }); continue; }
    const concerts = matched.slice(0, 20).map(c => ({ venue: c.venue, city: c.city, country: c.country, date: c.date, capacity: null, source: c.source, url: c.url }));
    out.push({ name, popularity: null, genre: matched[0].genre || '', concert: concerts[0], concerts });
  }
  const found = out.filter(o => o.concert).length;
  if (found === 0) {
    for (const star of FAMOUS_FALLBACK) {
      const m = await findTicketmasterExact(star);
      if (m.length) {
        const concerts = m.slice(0, 5).map(c => ({ venue: c.venue, city: c.city, country: c.country, date: c.date, capacity: null, source: c.source, url: c.url }));
        out.push({ name: star + ' ⭐', popularity: null, genre: m[0].genre || '', concert: concerts[0], concerts, fallback: true });
      }
      if (out.filter(o => o.concert).length >= 6) break;
    }
  }
  res.json(out);
});
app.get('/api/top-world', async (req, res) => {
  const now = Date.now();
  if (topWorldCache.data && (now - topWorldCache.time) < 3600000) return res.json(topWorldCache.data);
  const out = [];
  for (const star of TOP_WORLD) {
    try {
      const m = await findTicketmasterExact(star);
      if (m.length) {
        const concerts = m.slice(0, 5).map(c => ({ venue: c.venue, city: c.city, country: c.country, date: c.date, capacity: null, source: c.source, url: c.url }));
        if (out.some(o => o.name === star)) continue;
        out.push({ name: star, popularity: null, genre: m[0].genre || '', concert: concerts[0], concerts });
      }
    } catch (e) {}
    if (out.length >= 12) break;
  }
  out.sort((a, b) => {
    const aFR = a.concert.country === 'FR' ? 0 : 1;
    const bFR = b.concert.country === 'FR' ? 0 : 1;
    if (aFR !== bFR) return aFR - bFR;
    return new Date(a.concert.date) - new Date(b.concert.date);
  });
  topWorldCache = { data: out, time: now };
  res.json(out);
});

/* ==========================================================
   AGENT 4 : DECOUVERTE PAR GENRE (LLM Gemini)
   ========================================================== */
function tryParse(t) {
  try { return JSON.parse(t); } catch (e) { return undefined; }
}
function repairJson(t) {
  const stack = [];
  let inStr = false;
  let esc = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') stack.pop();
  }
  let out = t;
  if (inStr) out += '"';
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i];
  return out.replace(/,\s*([}\]])/g, '$1').replace(/:\s*([}\]])/g, ':null$1');
}
function extractJson(text) {
  if (!text) return null;
  let t = String(text).replace(/^\uFEFF/, '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const first = t.indexOf('{');
  if (first === -1) return null;
  const last = t.lastIndexOf('}');
  t = last > first ? t.slice(first, last + 1) : t.slice(first);
  let r = tryParse(t);
  if (r !== undefined) return r;
  r = tryParse(repairJson(t));
  if (r !== undefined) return r;
  return null;
}
function modelList() {
  const list = [];
  const push = m => { if (m && list.indexOf(m) === -1) list.push(m); };
  push(lastGoodModel);
  push(GEMINI_MODEL);
  push(GEMINI_DEFAULT);
  for (const m of GEMINI_FALLBACKS) push(m);
  return list;
}
function geminiOnce(model, prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 3000, responseMimeType: 'application/json' }
    });
    const u = new URL('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(GEMINI_KEY));
    const options = { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: GEMINI_TIMEOUT };
    const req = https.request(u, options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          let msg = 'HTTP ' + res.statusCode;
          try { const e = JSON.parse(data).error; msg = (e.code || res.statusCode) + ' ' + (e.message || data.slice(0, 200)); } catch (x) { msg = res.statusCode + ' ' + data.slice(0, 200); }
          reject(Object.assign(new Error(msg), { status: res.statusCode, raw: data }));
          return;
        }
        let text = '';
        try {
          const j = JSON.parse(data);
          const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
          for (const p of parts) { if (p && p.text) text += p.text; }
        } catch (e) { reject(new Error('Reponse Gemini illisible')); return; }
        if (!text) { reject(new Error('Reponse Gemini vide')); return; }
        const obj = extractJson(text);
        if (!obj) { reject(new Error('JSON invalide du LLM')); return; }
        resolve(obj);
      });
    });
    req.on('timeout', () => req.destroy(new Error('Timeout Gemini')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
async function gemini(prompt) {
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY manquant dans Render');
  const models = modelList();
  let lastErr = null;
  for (const m of models) {
    try {
      const out = await geminiOnce(m, prompt);
      lastGoodModel = m;
      if (m !== GEMINI_MODEL) { GEMINI_MODEL = m; console.log('Modele Gemini actif : ' + m); }
      return out;
    } catch (e) {
      lastErr = e;
      const retryable = e.status === 404 || e.status === 429 || e.status === 500 || e.status === 503 || /Timeout|illisible|vide|invalide/i.test(e.message);
      console.log('Gemini ' + m + ' -> ' + e.message.slice(0, 140));
      if (!retryable) break;
    }
  }
  throw lastErr || new Error('Gemini indisponible');
}
function frDate(iso) {
  if (!iso) return '?';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '?';
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
async function buildProfile(token, limit) {
  const top = await getTopArtists(token, 20);
  const profile = [];
  for (const a of top.slice(0, limit)) {
    profile.push({
      name: a.name,
      popularity: a.popularity,
      spotifyGenres: (a.genres || []).slice(0, 2),
      tmGenre: await getAttractionGenre(a.name, null)
    });
  }
  return profile;
}
app.get('/api/profile', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const profile = await buildProfile(token, 12);
    res.json({ profile, hasKey: !!GEMINI_KEY, model: GEMINI_MODEL });
  } catch (e) { res.status(500).json({ error: 'Impossible de lire ton profil' }); }
});
app.post('/api/discover', async (req, res) => {
  const { region, homeCity } = req.body || {};
  if (!GEMINI_KEY) return res.status(503).json({ error: 'GEMINI_API_KEY manquant dans Render' });
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Connecte-toi a Spotify d abord' });
  let profile = [];
  try { profile = await buildProfile(token, 12); } catch (e) {}
  if (!profile.length) return res.status(400).json({ error: 'Impossible de lire ton profil Spotify' });

  const profKey = profile.map(p => normalizeArtist(p.name)).sort().join('|');
  const now = Date.now();
  let pool = null;
  if (discoverCache.data.length && discoverCache.key === profKey && (now - discoverCache.time) < 1800000) {
    pool = discoverCache.data;
  } else {
    const profSet = new Set(profKey.split('|'));
    const candidates = TOP_WORLD.filter(s => !profSet.has(normalizeArtist(s))).slice(0, 26);
    pool = [];
    const CHUNK = 8;
    const deadline = Date.now() + 55000;
    for (let i = 0; i < candidates.length; i += CHUNK) {
      if (Date.now() > deadline || pool.length >= 40) break;
      const slice = candidates.slice(i, i + CHUNK);
      const got = await Promise.all(slice.map(async c => {
        try {
          const m = await findTicketmasterExact(c);
          const fr = (m || []).filter(x => x.country === 'FR').slice(0, 3);
          if (!fr.length) return null;
          return { name: c, genre: m[0].genre || '', dates: fr.map(x => frDate(x.date) + ' ' + x.city + (x.venue ? ' (' + x.venue + ')' : '')) };
        } catch (e) { return null; }
      }));
      for (const g of got) if (g) pool.push(g);
    }
    discoverCache = { key: profKey, data: pool, time: now };
  }

  if (!pool.length) return res.status(503).json({ error: 'Aucun artiste en concert en France pour le moment, reessaie dans 1h' });

  const lines = [];
  lines.push('Artistes ecoutes par une personne (Spotify) :');
  profile.forEach(p => lines.push('- ' + p.name + ' (pop ' + p.popularity + ', genres: ' + ((p.spotifyGenres || []).join('/') || 'n/a') + ', Ticketmaster: ' + (p.tmGenre || 'n/a') + ')'));
  lines.push('');
  lines.push('Ville de depart : ' + (homeCity || 'non precisee'));
  lines.push('Region souhaitee : ' + (region || 'toute la France'));
  lines.push('');
  lines.push('Artistes en concert en France (donnees reelles) :');
  pool.forEach(p => {
    lines.push('- ' + p.name + ' [' + (p.genre || 'n/a') + '] : ' + p.dates.join(' / '));
  });
  lines.push('');
  lines.push('Tache : propose 5 artistes a aller voir, differents de la liste ecoutee.');
  lines.push('Criteres : proximite du lieu (prefere sa region si connu), genre proche du profil, nombre de dates.');
  lines.push('Ne propose AUCUN artiste absent de la liste "Artistes en concert en France".');
  lines.push('Score de 0 a 10 = probabilite que la personne y aille.');
  lines.push('Reponds UNIQUEMENT en JSON : {"suggestions":[{"name":"","score":8,"why":"1 phrase","dates":[""],"near":true}]}');

  try {
    const out = await gemini(lines.join('\n'));
    const valid = new Set(pool.map(p => normalizeArtist(p.name)));
    const sugg = (out && out.suggestions ? out.suggestions : [])
      .filter(s => s && valid.has(normalizeArtist(s.name)))
      .slice(0, 5)
      .map(s => ({
        name: s.name,
        score: Math.max(0, Math.min(10, Number(s.score) || 0)),
        why: String(s.why || '').slice(0, 220),
        dates: (s.dates || []).map(String).slice(0, 3),
        near: !!s.near
      }));
    if (!sugg.length) return res.status(502).json({ error: 'Le LLM a propose des artistes introuvables, reessaie' });
    res.json({ suggestions: sugg, poolSize: pool.length, hasKey: true, model: GEMINI_MODEL });
  } catch (e) {
    res.status(502).json({ error: 'LLM indisponible : ' + e.message });
  }
});
app.listen(PORT, () => {
  console.log('Concert Alert running on port ' + PORT);
  console.log('Ticketmaster key set: ' + !!TICKETMASTER_KEY);
  console.log('Gemini key set: ' + !!GEMINI_KEY);
  console.log('Gemini model: ' + GEMINI_MODEL + (GEMINI_MODEL_LOCKED ? ' (fixe)' : ' (auto)'));
});
