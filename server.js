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

const TICKETMASTER_API_KEY = process.env.TICKETMASTER_API_KEY || '';
const BANDSINTOWN_APP_ID = process.env.BANDSINTOWN_APP_ID || 'concert-alert';

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

let concertCache = new Map();

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

async function searchBandsintown(artistName) {
  var encoded = encodeURIComponent(artistName);
  var url = 'https://rest.bandsintown.com/artists/' + encoded + '/events?app_id=' + BANDSINTOWN_APP_ID;
  try {
    var response = await axios.get(url, { timeout: 10000 });
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
    console.error('Bandsintown error for ' + artistName + ':', err.message);
    return [];
  }
}

async function searchConcertsForArtist(artistName) {
  var results = await Promise.all([
    searchTicketmaster(artistName),
    searchBandsintown(artistName),
  ]);
  var tm = results[0];
  var bit = results[1];
  var combined = tm.concat(bit);

  var seen = {};
  var unique = [];
  for (var i = 0; i < combined.length; i++) {
    var c = combined[i];
    var key = c.date + '-' + normalize(c.venue);
    if (seen[key]) continue;
    seen[key] = true;
    unique.push(c);
  }

  unique.sort(function(a, b) {
    return new Date(a.date) - new Date(b.date);
  });

  return unique;
}

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
  res.json({
    status: 'ok',
    cacheSize: concertCache.size,
    uptime: process.uptime(),
  });
});

app.get('*', function(req, res) {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

var protocol = USE_HTTPS ? 'https' : 'http';
var server;
if (USE_HTTPS) {
  var pfxPath = HTTPS_PFX || path.join(__dirname, 'cert', 'concert.pfx');
  server = https.createServer({ pfx: fs.readFileSync(pfxPath), passphrase: HTTPS_PASSPHRASE || 'concert' }, app);
} else {
  server = http.createServer(app);
}

server.listen(PORT, function() {
  console.log('Concert Alert running at ' + protocol + '://localhost:' + PORT);
});
