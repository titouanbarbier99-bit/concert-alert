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
  if (eventName === n) return true;
  if (lineup.indexOf(n) > -1) return true;
  if (attractions.indexOf(n) > -1) return true;
  if (eventName.indexOf(n) > -1) return true;
  return false;
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

// TICKETMASTER

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

// BANDSINTOWN

async function searchBandsintown(artistName) {
  var encoded = encodeURIComponent(artistName);
  var url = 'https://rest.bandsintown.com/artists/' + encoded + '/events?app_id=' + BANDSINTOWN_APP_ID;
  try {
    var response = await axios.get(url, {
      timeout: 10000,
      headers: { 'User-Agent': 'ConcertAlert/1.0', 'Accept': 'application/json' },
    });
    if (!Array.isArray(response.data)) return [];
    return response.data
      .filter(function(e) { return e.upcoming; })
      .filter(function(e) {
        return new Date(e.datetime) >= new Date();
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
          country: (
