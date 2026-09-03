require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const USE_HTTPS = process.env.USE_HTTPS === 'true';
const HTTPS_PFX = process.env.HTTPS_PFX;
const HTTPS_PASSPHRASE = process.env.HTTPS_PASSPHRASE;

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || `http://localhost:${PORT}/callback`;
const BANDSINTOWN_APP_ID = process.env.BANDSINTOWN_APP_ID || 'concert-alert';
const USER_COUNTRY = process.env.USER_COUNTRY || 'France';
const USER_CITY = process.env.USER_CITY || 'Paris';

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const userSessions = new Map();
let concertCache = new Map();

function generateRandomString(length) {
  return crypto.randomBytes(length).toString('hex').slice(0, length);
}

function base64Encode(str) {
  return Buffer.from(str).toString('base64');
}

// ─── SPOTIFY AUTH ROUTES ───

app.get('/login', (req, res) => {
  const state = generateRandomString(16);
  const scope = 'playlist-read-private playlist-read-collaborative';
  const authUrl = new URL('https://accounts.spotify.com/authorize');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', SPOTIFY_CLIENT_ID);
  authUrl.searchParams.set('scope', scope);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('show_dialog', 'true');
  res.redirect(authUrl.toString());
});

app.get('/callback', async (req, res) => {
  const code = req.query.code;
  const state = req.query.state;
  if (!code) return res.redirect('/?error=auth_denied');
  try {
    const tokenResponse = await axios.post('https://accounts.spotify.com/api/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
      }), {
        headers: {
          'Authorization': 'Basic ' + base64Encode(SPOTIFY_CLIENT_ID + ':' + SPOTIFY_CLIENT_SECRET),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

    const { access_token, refresh_token, expires_in } = tokenResponse.data;
    userSessions.set(state, { access_token, refresh_token, expires_in, created: Date.now() });

    res.redirect(`/?token=${encodeURIComponent(access_token)}#authenticated`);
  } catch (err) {
    console.error('Auth callback error:', err.message);
    res.redirect('/?error=token_failed');
  }
});

// ─── API ROUTES ───

app.get('/api/playlists', async (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const playlists = [];
    let url = 'https://api.spotify.com/v1/me/playlists?limit=50';
    while (url) {
      const response = await axios.get(url, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
            const items = Array.isArray(response.data.items) ? response.data.items : [];
      playlists.push(...items.map(p => ({
        id: p.id,
        name: p.name,
        image: p.images?.[0]?.url,
        trackCount: (p.tracks && typeof p.tracks.total === 'number') ? p.tracks.total : 0,
        owner: p.owner ? p.owner.display_name : '',
      })));
      url = response.data.next || null;
    }
    res.json({ playlists });
  } catch (err) {
    console.error('Error fetching playlists:', err.response?.status, err.message);
    res.status(500).json({ error: 'Failed to fetch playlists' });
  }
});

app.get('/api/playlists/:id/artists', async (req, res) => {
  const token = req.query.token;
  const playlistId = req.params.id;
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const artistsMap = new Map();
    let url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100`;
    while (url) {
      const response = await axios.get(url, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      for (const item of response.data.items) {
        if (!item.track || !item.track.artists) continue;
        for (const artist of item.track.artists) {
          if (artistsMap.has(artist.id)) {
            const existing = artistsMap.get(artist.id);
            existing.trackCount += 1;
          } else {
            artistsMap.set(artist.id, {
              id: artist.id,
              name: artist.name,
              trackCount: 1,
            });
          }
        }
      }
      url = response.data.next;
    }
    const artists = Array.from(artistsMap.values()).sort((a, b) => b.trackCount - a.trackCount);
    res.json({ artists });
  } catch (err) {
    console.error('Error fetching artists:', err.message);
    res.status(500).json({ error: 'Failed to fetch artists' });
  }
});

// ─── CONCERT SEARCH (Bandsintown) ───

async function searchConcertsForArtist(artistName) {
  const encoded = encodeURIComponent(artistName);
  const url = `https://rest.bandsintown.com/artists/${encoded}/events?app_id=${BANDSINTOWN_APP_ID}`;
  try {
    const response = await axios.get(url, { timeout: 10000 });
    if (!Array.isArray(response.data)) return [];
    return response.data
      .filter(e => e.upcoming)
      .filter(e => {
        const eventDate = new Date(e.datetime);
        return eventDate >= new Date();
      })
      .map(e => ({
        artist: artistName,
        date: e.datetime,
        venue: e.venue?.name || 'Unknown venue',
        city: e.venue?.city || 'Unknown',
        country: e.venue?.country || 'Unknown',
        region: e.venue?.region || '',
        latitude: e.venue?.latitude,
        longitude: e.venue?.longitude,
        ticketUrl: e.url,
        ticketType: e.description || '',
        lineup: e.lineup || [],
      }))
      .sort((a, b) => new Date(a.date) - new Date(b.date));
  } catch (err) {
    console.error(`Bandsintown error for ${artistName}:`, err.message);
    return [];
  }
}

// Venue capacity approximation from Songkick or Ticketmaster
async function getVenueCapacity(venueName, city) {
  try {
    const response = await axios.get(
      `https://www.songkick.com/api/3.0/search/venues.json`, {
        params: {
          apikey: process.env.SONGKICK_API_KEY || '',
          query: `${venueName} ${city}`,
        },
        timeout: 5000,
      }
    );
    if (response.data?.resultsPage?.results?.venue?.[0]) {
      return response.data.resultsPage.results.venue[0].capacity || null;
    }
  } catch (e) {}
  return null;
}

app.get('/api/concerts', async (req, res) => {
  const { artists, token } = req.query;
  if (!artists) return res.status(400).json({ error: 'No artists specified' });

  const artistList = artists.split(',').map(a => a.trim()).filter(Boolean);
  const allConcerts = [];

  for (const artist of artistList) {
    const cacheKey = `${artist}_${USER_CITY}`;
    const cached = concertCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 30 * 60 * 1000) {
      allConcerts.push(...cached.concerts);
      continue;
    }
    const concerts = await searchConcertsForArtist(artist);
    concertCache.set(cacheKey, { concerts, timestamp: Date.now() });
    allConcerts.push(...concerts);
  }

  allConcerts.sort((a, b) => new Date(a.date) - new Date(b.date));
  res.json({ concerts: allConcerts });
});

// ─── SINGLE ARTIST CONCERT SEARCH ───

app.get('/api/concerts/:artist', async (req, res) => {
  const artist = decodeURIComponent(req.params.artist);
  const concerts = await searchConcertsForArtist(artist);
  res.json({ concerts });
});

// ─── POLLING STATUS ───

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    cacheSize: concertCache.size,
    uptime: process.uptime(),
  });
});

// ─── SERVE FRONTEND ───

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const protocol = USE_HTTPS ? 'https' : 'http';
let server;
if (USE_HTTPS) {
  const pfxPath = HTTPS_PFX || path.join(__dirname, 'cert', 'concert.pfx');
  server = https.createServer({ pfx: fs.readFileSync(pfxPath), passphrase: HTTPS_PASSPHRASE || 'concert' }, app);
} else {
  server = http.createServer(app);
}

server.listen(PORT, () => {
  console.log(`\n🎵 Concert Alert running at ${protocol}://localhost:${PORT}`);
  console.log(`📍 Monitoring concerts in: ${USER_CITY}, ${USER_COUNTRY}`);
  console.log(`\n1. Go to ${protocol}://localhost:${PORT}`);
  console.log(`2. Log in with Spotify`);
  console.log(`3. Select a playlist`);
  console.log(`4. Get concert alerts!\n`);
});
