var spotifyToken = null;
var artistList = [];
var allConcerts = [];

function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(function(s) { s.classList.remove('active'); });
  document.getElementById(screenId).classList.add('active');
}

document.addEventListener('DOMContentLoaded', function() {
  var params = new URLSearchParams(window.location.search);
  var hash = window.location.hash;
  if (params.has('token') || hash.indexOf('token=') > -1) {
    var token = params.get('token');
    if (!token && hash.indexOf('token=') > -1) {
      token = hash.split('token=')[1].split('&')[0];
    }
    spotifyToken = token;
    window.history.replaceState({}, '', '/');
    showScreen('screen-artists');
    loadSpotifyArtists();
  } else {
    showScreen('screen-login');
  }
});

async function loadSpotifyArtists() {
  if (!spotifyToken) return;
  var container = document.getElementById('detected-artists');
  container.innerHTML = '<div class="spinner" style="width:24px;height:24px"></div>';

  var artists = [];

  try {
    var topRes = await fetch('https://api.spotify.com/v1/me/top/artists?limit=20&time_range=short_term', {
      headers: { 'Authorization': 'Bearer ' + spotifyToken }
    });
    var topData = await topRes.json();
    if (topData.items) {
      topData.items.forEach(function(a) {
        artists.push({ name: a.name, source: 'top' });
      });
    }
  } catch (e) {}

  try {
    var recentRes = await fetch('https://api.spotify.com/v1/me/player/recently-played?limit=50', {
      headers: { 'Authorization': 'Bearer ' + spotifyToken }
    });
    var recentData = await recentRes.json();
    if (recentData.items) {
      var seen = {};
      artists.forEach(function(a) { seen[a.name.toLowerCase()] = true; });
      recentData.items.forEach(function(item) {
        if (item.track && item.track.artists) {
          item.track.artists.forEach(function(ar) {
            if (!seen[ar.name.toLowerCase()]) {
              seen[ar.name.toLowerCase()] = true;
              artists.push({ name: ar.name, source: 'recent' });
            }
          });
        }
      });
    }
  } catch (e) {}

  container.innerHTML = '';
  if (artists.length === 0) {
    container.innerHTML = '<p style="color:var(--text-dim)">Aucun artiste détecté. Ajoute-les manuellement.</p>';
    return;
  }

  artists.forEach(function(a) {
    addArtistDirect(a.name);
  });
}

function addArtist() {
  var input = document.getElementById('artist-input');
  var name = input.value.trim();
  if (!name) return;
  if (artistList.some(function(a) { return a.toLowerCase() === name.toLowerCase(); })) {
    showToast('Deja ajoute');
    input.value = '';
    return;
  }
  artistList.push(name);
  input.value = '';
  renderTags();
  renderDetectedTags();
  updateSearchButton();
  input.focus();
}

function addArtistDirect(name) {
  if (artistList.some(function(a) { return a.toLowerCase() === name.toLowerCase(); })) return;
  artistList.push(name);
  renderDetectedTags();
  renderTags();
  updateSearchButton();
}

function removeArtist(index) {
  artistList.splice(index, 1);
  renderDetectedTags();
  renderTags();
  updateSearchButton();
}

function renderTags() {
  var container = document.getElementById('artist-tags');
  container.innerHTML = artistList.map(function(a, i) {
    return '<span class="artist-tag">' + a + ' <button onclick="removeArtist(' + i + ')">x</button></span>';
  }).join('');
  document.getElementById('artist-count').textContent =
    artistList.length > 0 ? artistList.length + ' artiste' + (artistList.length > 1 ? 's' : '') : '';
}

function renderDetectedTags() {
  var container = document.getElementById('detected-artists');
  container.innerHTML = artistList.map(function(a, i) {
    return '<span class="artist-tag detected">' + a + ' <button onclick="removeArtist(' + i + ')">x</button></span>';
  }).join('');
}

function updateSearchButton() {
  document.getElementById('btn-search').disabled = artistList.length === 0;
}

async function searchConcerts() {
  if (artistList.length === 0) return;
  showScreen('screen-alerts');
  var loading = document.getElementById('artists-loading');
  var container = document.getElementById('concerts-container');
  var noConcerts = document.getElementById('no-concerts');
  loading.style.display = 'flex';
  container.innerHTML = '';
  noConcerts.style.display = 'none';

  document.getElementById('artist-summary').textContent = artistList.length + ' artiste' + (artistList.length > 1 ? 's' : '') + ' en cours de recherche...';

  allConcerts = [];
  var total = artistList.length;

  for (var i = 0; i < total; i++) {
    var artist = artistList[i];
    var progress = document.getElementById('progress-fill');
    progress.style.width = ((i + 1) / total * 100) + '%';
    document.getElementById('loading-text').textContent = 'Recherche : ' + artist + ' (' + (i + 1) + '/' + total + ')...';

    try {
      var res = await fetch('/api/concerts/' + encodeURIComponent(artist));
      var data = await res.json();
      if (data.concerts && data.concerts.length > 0) {
        allConcerts.push.apply(allConcerts, data.concerts);
      }
    } catch (err) {
      console.error('Error searching ' + artist, err);
    }
  }

  document.getElementById('progress-fill').style.width = '100%';
  document.getElementById('loading-text').textContent = 'Termine !';
  setTimeout(function() { loading.style.display = 'none'; }, 500);

  document.getElementById('artist-summary').textContent =
    allConcerts.length > 0
      ? allConcerts.length + ' concert' + (allConcerts.length > 1 ? 's' : '') + ' trouve' + (allConcerts.length > 1 ? 's' : '')
      : '';

  renderConcerts(allConcerts);
}

function renderConcerts(concerts) {
  var container = document.getElementById('concerts-container');
  var noConcerts = document.getElementById('no-concerts');
  container.innerHTML = '';

  if (concerts.length === 0) {
    noConcerts.style.display = 'block';
    document.getElementById('alerts-count').textContent = '0 concert';
    return;
  }
  noConcerts.style.display = 'none';
  document.getElementById('alerts-count').textContent = concerts.length + ' concert' + (concerts.length > 1 ? 's' : '');

  var grouped = {};
  for (var ci = 0; ci < concerts.length; ci++) {
    var concert = concerts[ci];
    if (!grouped[concert.artist]) grouped[concert.artist] = [];
    grouped[concert.artist].push(concert);
  }

  var artistNames = Object.keys(grouped);
  for (var ai = 0; ai < artistNames.length; ai++) {
    var artist = artistNames[ai];
    var artistConcerts = grouped[artist];
    var section = document.createElement('div');
    section.className = 'artist-section';
    section.innerHTML = '<div class="artist-section-header"><h3>' + artist + '</h3><span class="track-badge">' + artistConcerts.length + ' concert' + (artistConcerts.length > 1 ? 's' : '') + '</span></div>';
    for (var j = 0; j < artistConcerts.length; j++) {
      var c = artistConcerts[j];
      var date = new Date(c.date);
      var day = date.getDate();
      var month = date.toLocaleDateString('fr-FR', { month: 'short' });
      var year = date.getFullYear();
      var fullDate = date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      var hourStr = c.date.indexOf('T') > -1 ? date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
      var location = [c.city, c.country].filter(Boolean).join(', ');
      var capacity = c.capacity ? '<span class="concert-tag capacity">~' + Number(c.capacity).toLocaleString('fr-FR') + ' places</span>' : '';
      var source = c.source ? '<span class="concert-tag source">' + c.source + '</span>' : '';
      var card = document.createElement('div');
      card.className = 'concert-card';
      card.innerHTML = '<div class="concert-date-box"><div class="day">' + day + '</div><div class="month">' + month + '</div><div class="year">' + year + '</div></div><div class="concert-info"><div class="concert-venue">' + c.venue + '</div><div class="concert-location">' + location + '</div><div class="concert-tags"><span class="concert-tag">' + fullDate + '</span>' + (hourStr ? '<span class="concert-tag">' + hourStr + '</span>' : '') + capacity + source + '</div></div><div class="concert-actions">' + (c.ticketUrl ? '<a href="' + c.ticketUrl + '" target="_blank" class="btn-ticket">Billets</a>' : '') + '</div>';
      section.appendChild(card);
    }
    container.appendChild(section);
  }
}

function filterConcerts(query) {
  if (!query.trim()) { renderConcerts(allConcerts); return; }
  var q = query.toLowerCase();
  var filtered = allConcerts.filter(function(c) {
    return c.artist.toLowerCase().indexOf(q) > -1 || c.venue.toLowerCase().indexOf(q) > -1 || c.city.toLowerCase().indexOf(q) > -1 || c.country.toLowerCase().indexOf(q) > -1;
  });
  renderConcerts(filtered);
}

function showToast(message) {
  var container = document.getElementById('toast-container');
  var toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = message + '<button class="toast-close" onclick="this.parentElement.remove()">x</button>';
  container.appendChild(toast);
  setTimeout(function() { toast.remove(); }, 3000);
}

function logout() {
  spotifyToken = null;
  artistList = [];
  allConcerts = [];
  showScreen('screen-login');
}
