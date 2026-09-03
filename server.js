require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:' + PORT + '/callback';
const TICKETMASTER_API_KEY = process.env.TICKETMASTER_API_KEY || '';
const BANDSINTOWN_APP_ID = process.env.BANDSINTOWN_APP_ID || 'concert-alert';

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

let concertCache = new Map();

function generateRandomString(length) {
  return crypto.randomBytes(length).toString('hex').slice(0, length);
}

function base64Encode(str) {
  return Buffer.from(str).toString('base64');
}

function normalize(str) {
  return String(str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, '').trim();
}

function artistMatchesEvent(artistName, event) {
  var n = normalize(artistName);
  var eventName = normalize(event.name || '');
  var lineup = (event.lineup || []).map(function(a) { return normalize(a); }).join(' ');
  var attractions = ((event._embedded && event._embedded.attractions) || []).map(function(a) { return normalize(a.name); }).join(' ');
  var all = eventName + ' ' + lineup + ' ' + attractions;
  if (all.indexOf(n) > -1) return true;
  var words = n.split(' ').filter(function(w) { return w.length > 2; });
  return words.some(function(w) { return all.indexOf(w) > -1; });
}

// SPOTIFY AUTH

app.get('/login', function(req, res) {
  var state = generateRandomString(16);
  var scope = 'user-top-read user-read-recently-played user-read-email';
  var authUrl = 'https://accounts.spotify.com/authorize' +
    '?response_type=code' +
    '&client_id=' + encodeURIComponent(SPOTIFY_CLIENT_ID) +
    '&scope=' + encodeURIComponent(scope) +
    '&redirect_uri=' + encodeURIComponent(REDIRECT_URI) +
    '&state=' + state +
    '&show_dialog=true';
  res.redirect(authUrl);
});

app.get('/callback', async function(req, res) {
  var code = req.query.code;
  if (!code) return res.redirect('/?error=auth_denied');
  try {
    var tokenResponse = await axios.post('https://accounts.spotify.com/api/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: REDIRECT_URI,
      }), {
        headers: {
          'Authorization': 'Basic ' + base64Encode(SPOTIFY_CLIENT_ID + ':' + SPOTIFY_CLIENT_SECRET),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });
    var access_token = tokenResponse.data.access_token;
    res.redirect('/?token=' + encodeURIComponent(access_token) + '#authenticated');
  } catch (err) {
    console.error('Auth callback error:', err.message);
    res.redirect('/?error=token_failed');
  }
});

// SPOTIFY ARTIST SEARCH (pour trouver le bon nom avant de chercher les concerts)

async function searchSpotifyArtist(artistName) {
  if (!SPOTIFY_CLIENT_ID) return null;
  try {
    var tokenRes = await axios.post('https://accounts.spotify.com/api/token',
      'grant_type=client_credentials',
      {
        headers: {
          'Authorization': 'Basic ' + base64Encode(SPOTIFY_CLIENT_ID + ':' + SPOTIFY_CLIENT_SECRET),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });
    var token = tokenRes.data.access_token;
    var searchRes = await axios.get('https://api.spotify.com/v1/search', {
      params: { q: artistName, type: 'artist', limit: 5 },
      headers: { 'Authorization': 'Bearer ' + token },
    });
    var artists = searchRes.data.artists && searchRes.data.artists.items;
    if (!artists || artists.length === 0) return null;
    var n = normalize(artistName);
    var best = artists.find(function(a) { return normalize(a.name) === n; });
    if (!best) best = artists.find(function(a) { return normalize(a.name).indexOf(n) > -1 || n.indexOf(normalize(a.name)) > -1; });
    if (!best) best = artists[0];
    return { name: best.name, id: best.id, genres: best.genres || [], popularity: best.popularity };
  } catch (err) {
    return null;
  }
}

// CONCERT SEARCH - TICKETMASTER

async function searchTicketmaster(artistName) {
  if (!TICKETMASTER_API_KEY) return [];
  try {
    var response = await axios.get('https://app.ticketmaster.com/discovery/v2/events.json', {
      params: {
        apikey: TICKETMASTER_API_KEY,
        keyword: artistName,
        size: 50,
        classificationName: 'music',
        sort: 'date,asc',
      },
      timeout: 10000,
    });
    var events = (response.data && response.data._embedded && response.data._embedded.events) || [];
    var now = new Date();
    return events
      .filter(function(e) {
        var d = new Date(e.dates && e.dates.start && (e.dates.start.dateTime || e.dates.start.localDate));
        return d >= now;
      })
      .filter(function(e) {
        return artistMatchesEvent(artistName, e);
      })
      .map(function(e) {
        var venue = (e._embedded && e._embedded.venues && e._embedded.venues[0]) || {};
        return {
          artist: artistName,
          date: (e.dates && e.dates.start && (e.dates.start.dateTime || e.dates.start.localDate)) || '',
          venue: venue.name || 'Salle inconnue',
          city: (venue.city && venue.city.name) || '',
          country: (venue.country && venue.country.countryCode) || '',
          latitude: venue.location && venue.location.latitude,
          longitude: venue.location && venue.location.longitude,
          ticketUrl: e.url || '',
          lineup: (e._embedded && e._embedded.attractions || []).map(function(a) { return a.name; }) || [],
          source: 'Ticketmaster',
        };
      });
  } catch (err) {
    console.error('Ticketmaster error for ' + artistName + ':', err.response ? err.response.status : '', err.message);
    return [];
  }
}

// CONCERT SEARCH - BANDSINTOWN

async function searchBandsintown(artistName) {
  var encoded = encodeURIComponent(artistName);
  var url = 'https://rest.bandsintown.com/artists/' + encoded + '/events?app_id=' + BANDSINTOWN_APP_ID;
  try {
    var response = await axios.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'ConcertAlert/1.0',
        'Accept': 'application/json',
      },
    });
    if (!Array.isArray(response.data)) return [];
    return response.data
      .filter(function(e) { return e.upcoming; })
      .filter(function(e) {
        var eventDate = new Date(e.datetime);
        return eventDate >= new Date();
      })
      .filter(function(e) {
        return artistMatchesEvent(artistName, { name: '', lineup: e.lineup || [] });
      })
      .map(function(e) {
        return {
          artist: artistName,
          date: e.datetime,
          venue: (e.venue && e.venue.name) || 'Salle inconnue',
          city: (e.venue && e.venue.city) || '',
          country: (e.venue && e.venue.country) || '',
          latitude: e.venue && e.venue.latitude,
          longitude: e.venue && e.venue.longitude,
          ticketUrl: e.url || '',
          lineup: e.lineup || [],
          source: 'Bandsintown',
        };
      });
  } catch (err) {
    console.error('Bandsintown error for ' + artistName + ':', err.response ? err.response.status : '', err.message);
    return [];
  }
}

// CONCERT SEARCH - SONGKICK (gratuit, bon pour la France)

async function searchSongkick(artistName) {
  try {
    var searchRes = await axios.get('https://api.songkick.com/api/3.0/search/artists.json', {
      params: { apikey: process.env.SONGKICK_API_KEY || '', query: artistName },
      timeout: 10000,
    });
    var results = searchRes.data && searchRes.data.resultsPage && searchRes.data.resultsPage.results && searchRes.data.resultsPage.results.artist;
    if (!results || results.length === 0) return [];
    var n = normalize(artistName);
    var best = results.find(function(a) { return normalize(a.displayName) === n; });
    if (!best) best = results.find(function(a) { return normalize(a.displayName).indexOf(n) > -1; });
    if (!best) return [];
    var eventsRes = await axios.get('https://api.songkick.com/api/3.0/artists/' + best.id + '/upcoming.json', {
      params: { apikey: process.env.SONGKICK_API_KEY || '' },
      timeout: 10000,
    });
    var events = eventsRes.data && eventsRes.data.resultsPage && eventsRes.data.resultsPage.results && eventsRes.data.resultsPage.results.event;
    if (!events || !Array.isArray(events)) return [];
    var now = new Date();
    return events
      .filter(function(e) { return new Date(e.start && e.start.date) >= now; })
      .map(function(e) {
        var venue = e.venue || {};
        return {
          artist: artistName,
          date: (e.start && e.start.datetime) || (e.start && e.start.date) || '',
          venue: venue.displayName || 'Salle inconnue',
          city: (e.location && e.location.city) || '',
          country: (e.location && e.location.country && e.location.country.displayName) || '',
          latitude: venue.lat,
          longitude: venue.lng,
          ticketUrl: e.uri || '',
          lineup: [],
          source: 'Songkick',
        };
      });
  } catch (err) {
    console.error('Songkick error for ' + artistName + ':', err.message);
    return [];
  }
}

// RECHERCHE GLOBALE

async function searchConcertsForArtist(artistName) {
  var results = await Promise.all([
    searchTicketmaster(artistName),
    searchBandsintown(artistName),
    searchSongkick(artistName),
  ]);
  var all = results[0].concat(results[1]).concat(results[2]);

  var seen = {};
  var unique = [];
  for (var i = 0; i < all.length; i++) {
    var c = all[i];
    var key = (c.date || '').slice(0, 10) + '-' + normalize(c.venue);
    if (seen[key]) continue;
    seen[key] = true;
    unique.push(c);
  }

  unique.sort(function(a, b) {
    return new Date(a.date) - new Date(b.date);
  });

  return unique;
}

// ROUTES

app.get('/api/concerts/:artist', async function(req, res) {
  var artist = decodeURIComponent(req.params.artist);
  var cacheKey = artist;
  var cached = concertCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < 30 * 60 * 1000) {
    return res.json({ concerts: cached.concerts });
  }
  var concerts = await searchConcertsForArtist(artist);
  concertCache.set(cacheKey, { concerts: concerts, timestamp: Date.now() });
  res.json({ concerts: concerts });
});

app.get('/api/health', function(req, res) {
  res.json({ status: 'ok', cacheSize: concertCache.size, uptime: process.uptime() });
});

app.get('*', function(req, res) {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

var server = http.createServer(app);
server.listen(PORT, function() {
  console.log('Concert Alert running at http://localhost:' + PORT);
});
