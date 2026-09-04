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
  const scope = 'playlist-read-private playlist-read-collaborative user-read-private user-read-email user-top-read user-read-recently-played';
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
    console.error('SPOTIFY ERROR /api/playlists:',
      'status=', err.response?.status,
      '| message=', err.response?.data?.error?.message,
      '| raw=', JSON.stringify(err.response?.data).slice(0, 400),
      '| http=', err.message);
    res.status(500).json({ error: 'Failed to fetch playlists' });
  }
});

// ─── COMBINED MY-ARTISTS (playlists + top listened) ───

app.get('/api/my-artists', async (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(401).json({ error: 'No token' });

  const artistMap = new Map();
  const addArtist = (id, name, source) => {
    if (!name) return;
    if (!artistMap.has(id || name)) {
      artistMap.set(id || name, { id, name, sources: new Set() });
    }
    artistMap.get(id || name).sources.add(source);
  };

  // 1) Artistes des playlists
  try {
    let url = 'https://api.spotify.com/v1/me/playlists?limit=50';
    while (url) {
      const plRes = await axios.get(url, { headers: { 'Authorization': `Bearer ${token}` } });
      const playlists = plRes.data.items || [];
      for (const pl of playlists) {
        let tUrl = `https://api.spotify.com/v1/playlists/${pl.id}/tracks?limit=100`;
        try {
          while (tUrl) {
            const trRes = await axios.get(tUrl, { headers: { 'Authorization': `Bearer ${token}` } });
            for (const item of trRes.data.items) {
              if (!item.track || !item.track.artists) continue;
              for (const a of item.track.artists) {
                addArtist(a.id, a.name, 'playlist');
              }
            }
            tUrl = trRes.data.next;
          }
        } catch (err) {
          console.error('Playlist tracks blocked (403?) for', pl.name, '-', err.response?.status);
        }
      }
      url = plRes.data.next;
    }
  } catch (err) {
    console.error('Error fetching playlists:', err.response?.status, err.message);
  }

  // 2) Artistes les plus écoutés (top 50)
  let topArtists = [];
  try {
    const top = await axios.get('https://api.spotify.com/v1/me/top/artists?limit=50&time_range=medium_term', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    topArtists = top.data.items || [];
    for (const a of topArtists) {
      addArtist(a.id, a.name, 'top');
    }
  } catch (err) {
    console.error('Error fetching top artists:', err.response?.status, err.message);
  }

  // Enrichir avec la popularité Spotify (batch lookup par IDs)
  const ids = Array.from(artistMap.keys()).filter(id => id);
  const popMap = new Map();
  for (const a of topArtists) {
    if (a.popularity != null) popMap.set(a.id, a.popularity);
  }
  try {
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      const lookup = await axios.get(`https://api.spotify.com/v1/artists?ids=${batch.join(',')}`, {
        headers: {
