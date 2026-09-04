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
var concertCache = new Map();
var artistPopularity = new Map();
function genRand(len) { return crypto.randomBytes(len).toString('hex').slice(0, len); }
function b64(str) { return Buffer.from(str).toString('base64'); }
function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, '').trim(); }
function isFR(c) { var n = norm(c); return n === 'fr' || n === 'france' || n.indexOf('france') > -1; }
var MAJOR_VENUES = ['stade de france','velodrome','orange velodrome','la defense arena','paris la defense arena','accor arena','bercy','zenith','le zenith','zenith de paris','adidas arena','dock pullman','la seine musicale','le dome de paris','halle tony garnier','ldlc arena','arkaea arena','zenith de nantes','zenith de toulouse','zenith de lille','le grand rex','parc des prince','stade pierre-mauroy','matmut atlantique','allianz riviera','roazhon park','philharmonie de paris','salle pleyel','theatre des champs','l olympia','olympia','le bataclan','la cigale','stade velodrome','parc ol','fnac'];
function isMajorVN(v) { var n = norm(v); return MAJOR_VENUES.some(function(m) { return n.indexOf(m) > -1 || m.indexOf(n) > -1; }); }
var SPOTIFY_TOKEN = null;
async function spotifyClientToken() {
  if (SPOTIFY_TOKEN) return SPOTIFY_TOKEN;
  var tr = await axios.post('https://accounts.spotify.com/api/token', 'grant_type=client_credentials', { headers: { 'Authorization': 'Basic ' + b64(SPOTIFY_CLIENT_ID + ':' + SPOTIFY_CLIENT_SECRET), 'Content-Type': 'application/x-www-form-urlencoded' } });
  SPOTIFY_TOKEN = tr.data.access_token;
  return SPOTIFY_TOKEN;
}
async function getArtistPopularity(name) {
  try {
    var token = await spotifyClientToken();
    var r = await axios.get('https://api.spotify.com/v1/search', { params: { q: name, type: 'artist', limit: 1 }, headers: { 'Authorization': 'Bearer ' + token } });
    var items = r.data && r.data.artists && r.data.artists.items;
    if (!items || items.length === 0) return 0;
    return items[0].popularity || 0;
  } catch (e) { return 0; }
}
function matchArtist(name, ev) {
  var n = norm(name);
  var lineup = (ev.lineup || []).map(norm);
  var attr = ((ev._embedded && ev._embedded.attractions) || []).map(function(a) { return norm(a.name); });
  var en = norm(ev.name || '');
  if (lineup.indexOf(n) > -1) return true;
  if (attr.indexOf(n) > -1) return true;
  if (en === n) return true;
  if (n.indexOf(' ') === -1) {
    return lineup.some(function(l) { return l.split(' ').indexOf(n) > -1; }) ||
           attr.some(function(a) { return a.split(' ').indexOf(n) > -1; });
  }
  var n2 = n;
  var found = false;
  if (lineup.join(' | ').indexOf(n2) > -1) found = true;
  if (attr.join(' | ').indexOf(n2) > -1) found = true;
  if (en.indexOf(n2) > -1) found = true;
  return found;
}
app.get('/login', function(req, res) {
  var s = genRand(16);
  var scope = 'user-top-read user-read-recently-played user-read-email';
  res.redirect('https://accounts.spotify.com/authorize?response_type=code&client_id=' + encodeURIComponent(SPOTIFY_CLIENT_ID) + '&scope=' + encodeURIComponent(scope) + '&redirect_uri=' + encodeURIComponent(REDIRECT_URI) + '&state=' + s + '&show_dialog=true');
});
app.get('/callback', async function(req, res) {
  var code = req.query.code;
  if (!code) return res.redirect('/?error=auth_denied');
  try {
    var tr = await axios.post('https://accounts.spotify.com/api/token', new URLSearchParams({ grant_type: 'authorization_code', code: code, redirect_uri: REDIRECT_URI }), { headers: { 'Authorization': 'Basic ' + b64(SPOTIFY_CLIENT_ID + ':' + SPOTIFY_CLIENT_SECRET), 'Content-Type': 'application/x-www-form-urlencoded' } });
    res.redirect('/?token=' + encodeURIComponent(tr.data.access_token) + '#authenticated');
  } catch (err) { console.error('Auth error:', err.message); res.redirect('/?error=token_failed'); }
});
async function searchTM(name) {
  if (!TICKETMASTER_API_KEY) return [];
  try {
    var r = await axios.get('https://app.ticketmaster.com/discovery/v2/events.json', { params: { apikey: TICKETMASTER_API_KEY, keyword: name, size: 100, classificationName: 'music', sort: 'date,asc' }, timeout: 10000 });
    var ev = (r.data && r.data._embedded && r.data._embedded.events) || [];
    var now = new Date();
    return ev.filter(function(e) { return new Date(e.dates && e.dates.start && (e.dates.start.dateTime || e.dates.start.localDate)) >= now; }).filter(function(e) { return matchArtist(name, e); }).map(function(e) {
      var v = (e._embedded && e._embedded.venues && e._embedded.venues[0]) || {};
      var cc = (v.country && v.country.countryCode) || '';
      return { artist: name, date: (e.dates && e.dates.start && (e.dates.start.dateTime || e.dates.start.localDate)) || '', venue: v.name || 'Salle inconnue', city: (v.city && v.city.name) || '', country: cc, ticketUrl: e.url || '', lineup: (e._embedded && e._embedded.attractions || []).map(function(a) { return a.name; }) || [], source: 'Ticketmaster', isFrance: isFR(cc), isMajorVenue: isMajorVN(v.name || '') };
    });
  } catch (err) { return []; }
}
async function searchBIT(name) {
  var url = 'https://rest.bandsintown.com/artists/' + encodeURIComponent(name) + '/events?app_id=' + BANDSINTOWN_APP_ID;
  try {
    var r = await axios.get(url, { timeout: 10000, headers: { 'User-Agent': 'ConcertAlert/1.0', 'Accept': 'application/json' } });
    if (!Array.isArray(r.data)) return [];
    return r.data.filter(function(e) { return e.upcoming && new Date(e.datetime) >= new Date(); }).filter(function(e) { return matchArtist(name, { name: '', lineup: e.lineup || [] }); }).map(function(e) {
      var cc = (e.venue && e.venue.country) || '';
      return { artist: name, date: e.datetime, venue: (e.venue && e.venue.name) || 'Salle inconnue', city: (e.venue && e.venue.city) || '', country: cc, ticketUrl: e.url || '', lineup: e.lineup || [], source: 'Bandsintown', isFrance: isFR(cc), isMajorVenue: isMajorVN((e.venue && e.venue.name) || '') };
    });
  } catch (err) { return []; }
}
async function searchSK(name) {
  try {
    var sr = await axios.get('https://api.songkick.com/api/3.0/search/artists.json', { params: { apikey: process.env.SONGKICK_API_KEY || '', query: name }, timeout: 10000 });
    var res2 = sr.data && sr.data.resultsPage && sr.data.resultsPage.results && sr.data.resultsPage.results.artist;
    if (!res2 || res2.length === 0) return [];
    var n = norm(name);
    var best = res2.find(function(a) { return norm(a.displayName) === n; });
    if (!best) return [];
    var er = await axios.get('https://api.songkick.com/api/3.0/artists/' + best.id + '/upcoming.json', { params: { apikey: process.env.SONGKICK_API_KEY || '' }, timeout: 10000 });
    var ev2 = er.data && er.data.resultsPage && er.data.resultsPage.results && er.data.resultsPage.results.event;
    if (!ev2 || !Array.isArray(ev2)) return [];
    var now = new Date();
    return ev2.filter(function(e) { return new Date(e.start && e.start.date) >= now; }).map(function(e) {
      var v = e.venue || {};
      var cc = (e.location && e.location.country && e.location.country.displayName) || '';
      return { artist: name, date: (e.start && e.start.datetime) || (e.start && e.start.date) || '', venue: v.displayName || 'Salle inconnue', city: (e.location && e.location.city) || '', country: cc, ticketUrl: e.uri || '', lineup: [], source: 'Songkick', isFrance: isFR(cc), isMajorVenue: isMajorVN(v.displayName || '') };
    });
  } catch (err) { return []; }
}
async function searchConcerts(name) {
  var pop = await getArtistPopularity(name);
  var r = await Promise.all([searchTM(name), searchBIT(name), searchSK(name)]);
  var all = r[0].concat(r[1]).concat(r[2]);
  var seen = {};
  var uniq = [];
  for (var i = 0; i < all.length; i++) {
    var c = all[i];
    c.popularity = pop;
    var key = (c.date || '').slice(0, 10) + '-' + norm(c.venue);
    if (seen[key]) continue;
    seen[key] = true;
    uniq.push(c);
  }
  uniq.sort(function(a, b) {
    if (a.artist !== b.artist) return (b.popularity || 0) - (a.popularity || 0);
    return new Date(a.date) - new Date(b.date);
  });
  return uniq;
}
app.get('/api/concerts/:artist', async function(req, res) {
  var artist = decodeURIComponent(req.params.artist);
  var cached = concertCache.get(artist);
  if (cached && Date.now() - cached.ts < 30 * 60 * 1000) return res.json({ concerts: cached.data });
  var concerts = await searchConcerts(artist);
  concertCache.set(artist, { data: concerts, ts: Date.now() });
  res.json({ concerts: concerts });
});
app.get('/api/health', function(req, res) { res.json({ status: 'ok', cacheSize: concertCache.size, uptime: process.uptime() }); });
app.get('*', function(req, res) { res.sendFile(path.join(__dirname, 'public', 'index.html')); });
var server = http.createServer(app);
server.listen(PORT, function() { console.log('Concert Alert running at http://localhost:' + PORT); });
