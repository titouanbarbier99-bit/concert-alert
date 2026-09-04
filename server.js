const express = require('express');
const session = require('express-session');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '63a4911a71074a3882bbb5a21a77a767';
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || '28f6217957824064ba4e9b56bba6e222';
const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:3000/callback';
const TICKETMASTER_KEY = process.env.TICKETMASTER_KEY || 'lmSBuxsZpv2SuSIxH6mHowsuNuteTr7s';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const userSessions = new Map();
const currentState = new Map();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }
}));

// ── HELPERS ─────────────────────────────────────────────
function postForm(url, params) {
  const u = new URL(url);
  const body = Object.entries(params).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
  const options = {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
  };
  return new Promise((resolve, reject) => {
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
          if (res.statusCode >= 400) {
            const err = new Error('API error ' + res.statusCode);
            err.status = res.statusCode;
            err.body = j;
            reject(err);
          } else resolve(j);
        } catch (e) { reject(new Error(data)); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function artistMatches(name, event) {
  const target = name.toLowerCase().replace(/\s+/g, ' ').trim();
  const tokens = target.split(' ');
  const attraction = (event.attraction || '').toLowerCase();
  const eventName = (event.name || '').toLowerCase();
  const nb = String(event.nbArtists ?? 1);

  if (attraction && attraction === target) return true;
  if (attraction && (attraction.includes(target) || target.includes(attraction))) return true;
  if (eventName && eventName.includes(target)) return true;

  if (nb === '1' && tokens.length === 1) {
    if (attraction && attraction === target) return true;
    if (eventName && eventName.split(' ').includes(target)) return true;
  }

  if (nb !== '1' && tokens.length > 1) {
    let all = true;
    for (const t of tokens) {
      if (!(attraction && attraction.split(' ').includes(t))) { all = false; break; }
    }
    if (all) return true;
  }

  return false;
}

function isUpcoming(dateStr) {
  const d = new Date(dateStr);
  return !isNaN(d) && d.getTime() >= Date.now() - 86400000;
}

function normalizeArtist(name) {
  return name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

// ── ROUTES ─────────────────────────────────────────────
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
    const sessionId = crypto.randomBytes(24).toString('hex');
    userSessions.set(sessionId, { access_token: token.access_token, refresh_token: token.refresh_token, created: Date.now() });
    req.session.spotifySessionId = sessionId;
    res.redirect('/');
  } catch (e) {
    res.status(500).send('Token exchange failed: ' + e.message);
  }
});

app.get('/logout', (req, res) => {
  if (req.session.spotifySessionId) userSessions.delete(req.session.spotifySessionId);
  req.session.destroy(() => res.redirect('/'));
});

function getSession(req) {
  const id = req.session && req.session.spotifySessionId;
  if (!id || !userSessions.has(id)) return null;
  return userSessions.get(id);
}

app.get('/api/me', async (req, res) => {
  const sess = getSession(req);
  if (!sess) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const me = await get('https://api.spotify.com/v1/me', sess.access_token);
    res.json({ id: me.id, display_name: me.display_name, popMap: {} });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

async function getAllPlaylistTracks(sess) {
  const tracks = [];
  let playlists = [];
  try {
    let next = 'https://api.spotify.com/v1/me/playlists?limit=50';
    while (next) {
      const data = await get(next, sess.access_token);
      playlists = playlists.concat(data.items || []);
      next = data.next;
    }
  } catch (e) {
    return { tracks: [], error: 'playlists:' + e.message };
  }
  for (const pl of playlists) {
    try {
      let next = pl.tracks ? pl.tracks.href : null;
      if (!next) continue;
      while (next) {
        const data = await get(next, sess.access_token);
        for (const item of (data.items || [])) {
          if (item && item.track && item.track.artists) {
            for (const a of item.track.artists) tracks.push(a.name);
          }
        }
        next = data.next;
      }
    } catch (e) {
      // 403 on playlist tracks (dev mode) ignored
    }
  }
  return { tracks, error: null };
}

async function getTopArtists(sess, limit) {
  try {
    const data = await get('https://api.spotify.com/v1/me/top/artists?limit=' + limit + '&time_range=medium_term', sess.access_token);
    return (data.items || []).map(a => ({ name: a.name, id: a.id, popularity: a.popularity }));
  } catch (e) {
    return [];
  }
}

app.get('/api/my-artists', async (req, res) => {
  const sess = getSession(req);
  if (!sess) return res.status(401).json({ error: 'Not authenticated' });
  const type = req.query.type || 'all';
  let names = [];
  const countMap = {};

  if (type === 'all' || type === 'playlists') {
    const pl = await getAllPlaylistTracks(sess);
    pl.tracks.forEach(n => { const key = normalizeArtist(n); countMap[key] = (countMap[key] || 0) + 1; });
  }
  if (type === 'all' || type === 'top') {
    const top = await getTopArtists(sess, 50);
    top.forEach(a => {
      const key = normalizeArtist(a.name);
      countMap[key] = (countMap[key] || 0) + 1;
      if (!selectedSeen[key]) { topMap[key] = a; selectedSeen[key] = true; }
    });
  }

  let list = Object.entries(countMap)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => ({ name: k }));
  res.json({ artists: list.map(a => a.name) });
});

app.get('/api/playlists', async (req, res) => {
  const sess = getSession(req);
  if (!sess) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const data = await get('https://api.spotify.com/v1/me/playlists?limit=50', sess.access_token);
    res.json({ playlists: (data.items || []).map(p => ({ id: p.id, name: p.name, total: p.tracks.total })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/playlists/:id/artists', async (req, res) => {
  const sess = getSession(req);
  if (!sess) return res.status(401).json({ error: 'Not authenticated' });
  try {
    let next = 'https://api.spotify.com/v1/playlists/' + req.params.id + '/tracks?limit=100';
    const names = [];
    while (next) {
      const data = await get(next, sess.access_token);
      for (const item of (data.items || [])) {
        if (item && item.track && item.track.artists) for (const a of item.track.artists) names.push(a.name);
      }
      next = data.next;
    }
    res.json({ artists: names });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

async function enrichPopularityByID(names) {
  return { map: {}, resolved: {} };
}

app.get('/api/popularity', async (req, res) => {
  const sess = getSession(req);
  if (!sess) return res.status(401).json({ error: 'Not authenticated' });
  const name = req.query.name;
  if (!name) return res.json({ popularity: null });
  const { map } = await enrichPopularityByID([name]);
  res.json({ popularity: map[name] || null });
});

async function findTicketmasterEvents(name, country) {
  const fam = ['concert', 'music'];
  const params = new URLSearchParams({
    apikey: TICKETMASTER_KEY,
    keyword: name,
    size: '10',
    classificationName: fam.join(',')
  });
  if (country) params.set('countryCode', country);
  try {
    const data = await get('https://app.ticketmaster.com/discovery/v2/events.json?' + params.toString());
    return (data._embedded && data._embedded.events) || [];
  } catch (e) { return []; }
}

function parseEventEventhub(e) {
  const dateStr = e.start && e.start.date ? e.start.date : null;
  const venue = e.venue ? e.venue.name : 'Lieu inconnu';
  const city = e.venue && e.venue.location && e.venue.location.city ? e.venue.location.city : '';
  const attraction = e.attraction ? e.attraction.name : '';
  const url = e.url || '';
  return { date: dateStr, venue, city, country: '', attraction, url, type: 'eventhub', capacity: null, source: 'EH' };
}

app.post('/api/concerts/:artist', async (req, res) => {
  const artist = req.params.artist;
  const country = (req.body && req.body.country) || 'FR';
  if (!artist) return res.status(400).json({ error: 'Missing artist' });
  const results = [];
  results.push(...await findTicketmasterEvents(artist, country));
  const filtered = results.filter(e => artistMatches(artist, e)).filter(e => isUpcoming(e.date));
  const sorted = filtered.sort((a, b) => new Date(a.date) - new Date(b.date));
  if (sorted.length === 0) return res.json({ artist: artist, concert: null });
  const c = sorted[0];
  res.json({
    artist,
    concert: {
      venue: c.venue,
      city: c.city,
      date: c.date,
      country: c.country,
      capacity: c.capacity,
      source: c.type === 'eventhub' ? 'EventHub' : 'Ticketmaster',
      url: c.url
    }
  });
});

app.post('/api/multi-artist', async (req, res) => {
  const { artists } = req.body;
  if (!artists || !Array.isArray(artists)) return res.status(400).json({ error: 'Invalid body' });
  const out = [];
  for (const name of artists) {
    const country = 'FR';
    let concerts = [];
    concerts.push(...await findTicketmasterEvents(name, country));
    const matched = concerts.filter(e => artistMatches(name, e)).filter(e => isUpcoming(e.date));
    matched.sort((a, b) => new Date(a.date) - new Date(b.date));
    if (matched.length === 0) { out.push({ name, popularity: null, concert: null }); continue; }
    const c = matched[0];
    out.push({
      name,
      popularity: null,
      concert: {
        venue: c.venue,
        city: c.city,
        date: c.date,
        country: c.country,
        capacity: c.capacity,
        source: c.type === 'eventhub' ? 'EventHub' : 'Ticketmaster',
        url: c.url
      }
    });
  }
  res.json(out);
});

app.listen(PORT, () => {
  console.log('🎵 Concert Alert running on port ' + PORT);
});
