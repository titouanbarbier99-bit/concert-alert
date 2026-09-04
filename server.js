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

const userSessions = new Map();
const currentState = new Map();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function postForm(url, params) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = new URLSearchParams(params).toString();
    const options = {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    };
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error(data)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function get(url, accessToken, extraHeaders) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const options = { method: 'GET', headers: extraHeaders || {} };
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
  return name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
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
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: SPOTIFY_CLIENT_ID,
    scope,
    redirect_uri: REDIRECT_URI,
    state
  });
  res.redirect('https://accounts.spotify.com/authorize?' + params.toString());
});

app.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) { res.status(400).send('Login error: ' + error); return; }
  if (!state || !currentState.has(state)) { res.status(400).send('State mismatch'); return; }
  currentState.delete(state);
  try {
    const token = await postForm('https://accounts.spotify.com/api/token', {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: SPOTIFY_CLIENT_ID,
      client_secret: SPOTIFY_CLIENT_SECRET
    });
    const tokenId = crypto.randomBytes(24).toString('hex');
    userSessions.set(tokenId, token.access_token);
    res.cookie('ca_session', tokenId, { maxAge: 60 * 60 * 24 * 7 });
    res.redirect('/');
  } catch (e) {
    res.status(500).send('Login failed: ' + e.message);
  }
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
  } catch (e) {
    return res.json({ authenticated: false });
  }
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
  } catch (e) {
    res.json({ artists: [], popMap: {} });
  }
});

function artistMatches(name, event) {
  const target = normalizeArtist(name);
  const attraction = normalizeArtist(event.artist || '');
  const eventName = normalizeArtist(event.name || '');
  if (attraction && attraction === target) return true;
  if (eventName && eventName.includes(target)) return true;
  if (attraction && attraction.includes(target)) return true;
  return false;
}

function isUpcoming(dateStr) {
  const d = new Date(dateStr);
  return !isNaN(d) && d.getTime() >= Date.now() - 86400000;
}

async function findTicketmasterEvents(name) {
  const params = new URLSearchParams({
    apikey: TICKETMASTER_KEY,
    keyword: name,
    size: '20',
    classificationName: 'concert,music'
  });
  try {
    const data = await get('https://app.ticketmaster.com/discovery/v2/events.json?' + params.toString());
    const events = (data._embedded && data._embedded.events) || [];
    return events.map(e => ({
      artist: (e._embedded && e._embedded.attractions && e._embedded.attractions[0] && e._embedded.attractions[0].name) || e.name,
      eventName: e.name || '',
      venue: (e._embedded && e._embedded.venues && e._embedded.venues[0] && e._embedded.venues[0].name) || 'Lieu inconnu',
      city: (e._embedded && e._embedded.venues && e._embedded.venues[0] && e._embedded.venues[0].city && e._embedded.venues[0].city.name) || '',
      country: (e._embedded && e._embedded.venues && e._embedded.venues[0] && e._embedded.venues[0].country && e._embedded.venues[0].country.countryCode) || '',
      date: e.dates && e.dates.start && e.dates.start.localDate ? e.dates.start.localDate : null,
      url: e.url || '',
      source: 'Ticketmaster'
    }));
  } catch (e) { return []; }
}

app.post('/api/multi-artist', async (req, res) => {
  const { artists } = req.body;
  if (!artists || !Array.isArray(artists)) return res.status(400).json({ error: 'Invalid body' });
  const out = [];
  for (const name of artists) {
    let events = await findTicketmasterEvents(name);
    const matched = events.filter(e => artistMatches(name, e)).filter(e => isUpcoming(e.date));
    matched.sort((a, b) => new Date(a.date) - new Date(b.date));
    if (matched.length === 0) { out.push({ name, popularity: null, concert: null }); continue; }
    const c = matched[0];
    out.push({
      name,
      popularity: null,
      concert: {
        venue: c.venue,
        city: c.city,
        country: c.country,
        date: c.date,
        capacity: null,
        source: c.source,
        url: c.url
      }
    });
  }
  res.json(out);
});

app.listen(PORT, () => {
  console.log('🎵 Concert Alert running on port ' + PORT);
  console.log('Ticketmaster key set: ' + !!TICKETMASTER_KEY);
});
