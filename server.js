const express = require('express');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '63a4911a71074a3882bbb5a21a77a767';
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || '28f6217957824064ba4e9b56bba6e222';
const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:3000/callback';
const TICKETMASTER_KEY = process.env.TICKETMASTER_KEY || 'lmSBuxsZpv2SuSIxH6mHowsuNuteTr7s';

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
  return name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

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
    res.cookie('ca_session', tokenId, { httpOnly: true, maxAge: 60 * 60 * 24 * 7 });
    res.redirect('/');
  } catch (e) {
    res.status(500).send('Login failed: ' + e.message);
  }
});

function getToken(req) {
  const id = req.cookies ? req.cookies.ca_session : null;
  if (!id || !userSessions.has(id)) return null;
  return userSessions.get(id);
}

app.use((req, res, next) => {
  const header = req.headers.cookie || '';
  const match = header.match(/ca_session=([^;]+)/);
  req.cookies = match ? { ca_session: match[1] } : {};
  next();
});

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

async function getTopArtists(sess, limit) {
  try {
    const data = await get('https://api.spotify.com/v1/me/top/artists?limit=' + limit + '&time_range=medium_term', sess);
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
    top.forEach(a => {
      const key = normalizeArtist(a.name);
      if (!seen.has(key)) { seen.add(key); list.push(a.name); }
      if (a.popularity != null) popMap[a.name] = a.popularity;
    });
    res.json({ artists: list, popMap });
  } catch (e) {
    res.json({ artists: [], popMap: {} });
  }
});

function artistMatches(name, event) {
  const target = name.toLowerCase().replace(/\s+/g, ' ').trim();
  const attraction = (event.attraction || '').toLowerCase();
  const eventName = (event.name || '').toLowerCase();
  if (attraction && attraction === target) return true;
  if (attraction && (attraction.includes(target) || target.includes(attraction))) return true;
  if (eventName && eventName.includes(target)) return true;
  return false;
}

function isUpcoming(dateStr) {
  const d = new Date(dateStr);
  return !isNaN(d) && d.getTime() >= Date.now() - 86400000;
}

async function findTicketmasterEvents(name, country) {
  const params = new URLSearchParams({
    apikey: TICKETMASTER_KEY,
    keyword: name,
    size: '10',
    classificationName: 'concert,music'
  });
  if (country) params.set('countryCode', country);
  try {
    const data = await get('https://app.ticketmaster.com/discovery/v2/events.json?' + params.toString());
    return (data._embedded && data._embedded.events) || [];
  } catch (e) { return []; }
}

app.post('/api/multi-artist', async (req, res) => {
  const { artists } = req.body;
  if (!artists || !Array.isArray(artists)) return res.status(400).json({ error: 'Invalid body' });
  const out = [];
  for (const name of artists) {
    let events = await findTicketmasterEvents(name, 'FR');
    const matched = events.filter(e => artistMatches(name, e)).filter(e => isUpcoming(e.date));
    matched.sort((a, b) => new Date(a.date) - new Date(b.date));
    if (matched.length === 0) { out.push({ name, popularity: null, concert: null }); continue; }
    const c = matched[0];
    out.push({
      name,
      popularity: null,
      concert: {
        venue: c.venue || 'Lieu inconnu',
        city: c.city || '',
        date: c.date || null,
        country: 'FR',
        capacity: c.capacity || null,
        source: 'Ticketmaster',
        url: c.url || ''
      }
    });
  }
  res.json(out);
});

app.listen(PORT, () => {
  console.log('🎵 Concert Alert running on port ' + PORT);
});
