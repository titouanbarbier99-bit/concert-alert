const express = require('express');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const TICKETMASTER_KEY = process.env.TICKETMASTER_API_KEY || 'lmSBuxsZpv2SuSIxH6mHowsuNuteTr7s';

const FAMOUS_FALLBACK = ["Taylor Swift","Coldplay","Ed Sheeran","Beyonce","Drake","Rihanna","Bruno Mars","Adele","The Weeknd","Dua Lipa"];
const TOP_WORLD = ["Taylor Swift","Coldplay","Ed Sheeran","Beyonce","Drake","Rihanna","Bruno Mars","Adele","The Weeknd","Dua Lipa","Billie Eilish","Post Malone","Travis Scott","Kendrick Lamar","Bad Bunny","David Guetta","Calvin Harris","Imagine Dragons","Maroon 5","Metallica","U2","Arctic Monkeys","Gims","SCH","Ninho","Damso","Booba","Aya Nakamura","PNL","Orelsan","Shakira","Justin Bieber","Lady Gaga"];

let topWorldCache = { data: null, time: 0 };
const userSessions = new Map();
const currentState = new Map();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function postForm(url, params) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = new URLSearchParams(params).toString();
    const options = { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } };
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(new Error(data)); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
function get(url, accessToken) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const options = { method: 'GET', headers: {} };
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
    req.on('error', reject);
    req.end();
  });
}
function normalizeArtist(name) {
  return (name || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
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
    return (data.items || []).map(a => ({ name: a.name, popularity: a.popularity || null }));
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
    for (const a of top) {
      const key = normalizeArtist(a.name);
      if (!seen.has(key)) { seen.add(key); list.push(a.name); }
      if (a.popularity != null) popMap[a.name] = a.popularity;
    }
    res.json({ artists: list, popMap });
  } catch (e) { res.json({ artists: [], popMap: {} }); }
});
function mapTmEvent(e) {
  return {
    artist: (e._embedded && e._embedded.attractions && e._embedded.attractions[0] && e._embedded.attractions[0].name) || '',
    eventName: e.name || '',
    venue: (e._embedded && e._embedded.venues && e._embedded.venues[0] && e._embedded.venues[0].name) || 'Lieu inconnu',
    city: (e._embedded && e._embedded.venues && e._embedded.venues[0] && e._embedded.venues[0].city && e._embedded.venues[0].city.name) || '',
    country: (e._embedded && e._embedded.venues && e._embedded.venues[0] && e._embedded.venues[0].country && e._embedded.venues[0].country.countryCode) || '',
    date: e.dates && e.dates.start && (e.dates.start.dateTime || e.dates.start.localDate) ? (e.dates.start.dateTime || e.dates.start.localDate) : null,
    url: e.url || '',
    source: 'Ticketmaster'
  };
}
async function findAttractionId(name) {
  try {
    const target = normalizeArtist(name);
    const u = 'https://app.ticketmaster.com/discovery/v2/attractions.json?apikey=' + TICKETMASTER_KEY + '&keyword=' + encodeURIComponent(name) + '&size=20&locale=fr-fr';
    const data = await get(u);
    const list = (data._embedded && data._embedded.attractions) || [];
    for (const a of list) { if (normalizeArtist(a.name) === target) return a.id; }
    const u2 = 'https://app.ticketmaster.com/discovery/v2/attractions.json?apikey=' + TICKETMASTER_KEY + '&keyword=' + encodeURIComponent(name) + '&size=20';
    const data2 = await get(u2);
    const list2 = (data2._embedded && data2._embedded.attractions) || [];
    for (const a of list2) { if (normalizeArtist(a.name) === target) return a.id; }
    return null;
  } catch (e) { return null; }
}
async function findTicketmasterExact(name) {
  let all = [];
  const attId = await findAttractionId(name);
  if (attId) {
    try {
      const u = 'https://app.ticketmaster.com/discovery/v2/events.json?apikey=' + TICKETMASTER_KEY + '&attractionId=' + attId + '&size=50&sort=date,asc&locale=fr-fr';
      const data = await get(u);
      const ev = (data._embedded && data._embedded.events) || [];
      all = all.concat(ev.map(mapTmEvent));
    } catch (e) {}
    try {
      const uW = 'https://app.ticketmaster.com/discovery/v2/events.json?apikey=' + TICKETMASTER_KEY + '&attractionId=' + attId + '&size=50&sort=date,asc';
      const dataW = await get(uW);
      const evW = (dataW._embedded && dataW._embedded.events) || [];
      all = all.concat(evW.map(mapTmEvent));
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
    if (!matched.length) { out.push({ name, popularity: null, concert: null, concerts: [] }); continue; }
    const concerts = matched.slice(0, 20).map(c => ({ venue: c.venue, city: c.city, country: c.country, date: c.date, capacity: null, source: c.source, url: c.url }));
    out.push({ name, popularity: null, concert: concerts[0], concerts });
  }
  const found = out.filter(o => o.concert).length;
  if (found === 0) {
    for (const star of FAMOUS_FALLBACK) {
      const m = await findTicketmasterExact(star);
      if (m.length) {
        const concerts = m.slice(0, 5).map(c => ({ venue: c.venue, city: c.city, country: c.country, date: c.date, capacity: null, source: c.source, url: c.url }));
        out.push({ name: star + ' ⭐', popularity: null, concert: concerts[0], concerts, fallback: true });
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
        out.push({ name: star, popularity: null, concert: concerts[0], concerts });
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
app.listen(PORT, () => {
  console.log('🎵 Concert Alert running on port ' + PORT);
  console.log('Ticketmaster key set: ' + !!TICKETMASTER_KEY);
});
