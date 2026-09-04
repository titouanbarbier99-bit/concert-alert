var spotifyToken = new URLSearchParams(window.location.search).get('token') || '';
var artistList = [];
var allConcerts = [];

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(function(s) { s.classList.remove('active'); });
  document.getElementById(id).classList.add('active');
}

if (spotifyToken) {
  loadTopArtists();
}

async function loadTopArtists() {
  if (!spotifyToken) { showScreen('screen-artists'); return; }
  try {
    var res = await fetch('https://api.spotify.com/v1/me/top/artists?limit=10&time_range=medium_term', { headers: { 'Authorization': 'Bearer ' + spotifyToken } });
    var data = await res.json();
    var items = data.items || [];
    for (var i = 0; i < items.length; i++) {
      addArtistDirect(items[i].name);
    }
    showScreen('screen-artists');
  } catch (err) {
    showScreen('screen-artists');
  }
}

function addArtist() {
  var input = document.getElementById('artist-input');
  var name = input.value.trim();
  if (!name) return;
  if (artistList.some(function(a) { return a.name.toLowerCase() === name.toLowerCase(); })) {
    showToast('Deja ajoute');
    input.value = '';
    return;
  }
  artistList.push({ name: name, checked: true });
  input.value = '';
  renderList();
}

function addArtistDirect(name) {
  if (artistList.some(function(a) { return a.name.toLowerCase() === name.toLowerCase(); })) return;
  artistList.push({ name: name, checked: true });
  renderList();
}

function toggleArtist(index) {
  artistList[index].checked = !artistList[index].checked;
  renderList();
}

function removeArtist(index) {
  artistList.splice(index, 1);
  renderList();
}

function clearAllArtists() {
  artistList = [];
  renderList();
}

function selectedArtists() {
  return artistList.filter(function(a) { return a.checked; }).map(function(a) { return a.name; });
}

function renderList() {
  var container = document.getElementById('artist-list');
  if (artistList.length === 0) {
    container.innerHTML = '<p style="color:var(--text-dim);font-size:13px">Aucun artiste. Ajoute-en ou clique sur une suggestion.</p>';
  } else {
    container.innerHTML = artistList.map(function(a, i) {
      return '<label class="artist-row"><input type="checkbox" ' + (a.checked ? 'checked' : '') + ' onchange="toggleArtist(' + i + ')"><span class="artist-check">' + a.name + '</span><button class="artist-remove" onclick="removeArtist(' + i + ')">x</button></label>';
    }).join('');
  }
  var count = artistList.filter(function(a) { return a.checked; }).length;
  document.getElementById('artist-count').textContent = count + ' artiste' + (count !== 1 ? 's' : '') + ' coche';
  document.getElementById('btn-search').disabled = count === 0;
}

async function searchConcerts() {
  var names = selectedArtists();
  if (names.length === 0) return;
  showScreen('screen-alerts');
  var loading = document.getElementById('artists-loading');
  var container = document.getElementById('concerts-container');
  var noConcerts = document.getElementById('no-concerts');
  loading.style.display = 'flex';
  container.innerHTML = '';
  noConcerts.style.display = 'none';
  document.getElementById('artist-summary').textContent = names.length + ' artiste(s) en cours de recherche...';
  allConcerts = [];
  for (var i = 0; i < names.length; i++) {
    var artist = names[i];
    var progress = document.getElementById('progress-fill');
    progress.style.width = ((i + 1) / names.length * 100) + '%';
    document.getElementById('loading-text').textContent = 'Recherche : ' + artist + ' (' + (i + 1) + '/' + names.length + ')...';
    try {
      var res = await fetch('/api/concerts/' + encodeURIComponent(artist));
      var data = await res.json();
      if (data.concerts && data.concerts.length > 0) {
        allConcerts.push.apply(allConcerts, data.concerts);
      }
    } catch (err) {}
  }
  document.getElementById('progress-fill').style.width = '100%';
  document.getElementById('loading-text').textContent = 'Termine !';
  setTimeout(function() { loading.style.display = 'none'; }, 500);
  document.getElementById('artist-summary').textContent = allConcerts.length + ' concert(s) trouve';
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
    var c = concerts[ci];
    if (!grouped[c.artist]) grouped[c.artist] = [];
    grouped[c.artist].push(c);
  }
  var names = Object.keys(grouped);
  for (var ai = 0; ai < names.length; ai++) {
    var artist = names[ai];
    var ac = grouped[artist];
    var section = document.createElement('div');
    section.className = 'artist-section';
    section.innerHTML = '<div class="artist-section-header"><h3>' + artist + '</h3><span class="track-badge">' + ac.length + ' concert' + (ac.length > 1 ? 's' : '') + '</span></div>';
    for (var j = 0; j < ac.length; j++) {
      var c2 = ac[j];
      var date = new Date(c2.date);
      var day = date.getDate();
      var month = date.toLocaleDateString('fr-FR', { month: 'short' });
      var year = date.getFullYear();
      var fullDate = date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      var hourStr = c2.date.indexOf('T') > -1 ? date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
      var location = [c2.city, c2.country].filter(Boolean).join(', ');
      var source = c2.source ? '<span class="concert-tag source">' + c2.source + '</span>' : '';
      var card = document.createElement('div');
      card.className = 'concert-card';
      card.innerHTML = '<div class="concert-date-box"><div class="day">' + day + '</div><div class="month">' + month + '</div><div class="year">' + year + '</div></div><div class="concert-info"><div class="concert-venue">' + c2.venue + '</div><div class="concert-location">' + location + '</div><div class="concert-tags"><span class="concert-tag">' + fullDate + '</span>' + (hourStr ? '<span class="concert-tag">' + hourStr + '</span>' : '') + source + '</div></div><div class="concert-actions">' + (c2.ticketUrl ? '<a href="' + c2.ticketUrl + '" target="_blank" class="btn-ticket">Billets</a>' : '') + '</div>';
      section.appendChild(card);
    }
    container.appendChild(section);
  }
}

function filterConcerts(query) {
  if (!query.trim()) { renderConcerts(allConcerts); return; }
  var q = query.toLowerCase();
  renderConcerts(allConcerts.filter(function(c) {
    return c.artist.toLowerCase().indexOf(q) > -1 || c.venue.toLowerCase().indexOf(q) > -1 || c.city.toLowerCase().indexOf(q) > -1;
  }));
}

function showToast(message) {
  var container = document.getElementById('toast-container');
  var toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = message + '<button class="toast-close" onclick="this.parentElement.remove()">x</button>';
  container.appendChild(toast);
  setTimeout(function() { toast.remove(); }, 3000);
}
