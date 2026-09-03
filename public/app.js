let artistList = [];
let allConcerts = [];
let pollingInterval = null;

function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
}

function addArtist() {
  const input = document.getElementById('artist-input');
  const name = input.value.trim();
  if (!name) return;
  if (artistList.some(a => a.toLowerCase() === name.toLowerCase())) {
    showToast('Cet artiste est déjà dans la liste');
    input.value = '';
    return;
  }
  artistList.push(name);
  input.value = '';
  renderTags();
  updateSearchButton();
  input.focus();
}

function addArtistDirect(name) {
  if (artistList.some(a => a.toLowerCase() === name.toLowerCase())) {
    showToast('Déjà ajouté');
    return;
  }
  artistList.push(name);
  renderTags();
  updateSearchButton();
}

function removeArtist(index) {
  artistList.splice(index, 1);
  renderTags();
  updateSearchButton();
}

function renderTags() {
  const container = document.getElementById('artist-tags');
  container.innerHTML = artistList.map((a, i) =>
    '<span class="artist-tag">' + a + ' <button onclick="removeArtist(' + i + ')">✕</button></span>'
  ).join('');
  document.getElementById('artist-count').textContent =
    artistList.length > 0 ? artistList.length + ' artiste' + (artistList.length > 1 ? 's' : '') : '';
}

function updateSearchButton() {
  document.getElementById('btn-search').disabled = artistList.length === 0;
}

async function searchConcerts() {
  if (artistList.length === 0) return;
  showScreen('screen-alerts');
  const loading = document.getElementById('artists-loading');
  const container = document.getElementById('concerts-container');
  const noConcerts = document.getElementById('no-concerts');
  loading.style.display = 'flex';
  container.innerHTML = '';
  noConcerts.style.display = 'none';

  document.getElementById('artist-summary').textContent = artistList.length + ' artiste' + (artistList.length > 1 ? 's' : '') + ' en cours de recherche...';

  allConcerts = [];
  const total = artistList.length;

  for (let i = 0; i < total; i++) {
    const artist = artistList[i];
    const progress = document.getElementById('progress-fill');
    progress.style.width = ((i + 1) / total * 100) + '%';
    document.getElementById('loading-text').textContent = 'Recherche : ' + artist + ' (' + (i + 1) + '/' + total + ')...';

    try {
      const res = await fetch('/api/concerts/' + encodeURIComponent(artist));
      const data = await res.json();
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
  const container = document.getElementById('concerts-container');
  const noConcerts = document.getElementById('no-concerts');
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
      var fullDate = date.toLocaleDateString('fr-FR', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
      });
      var hourStr = c.date.indexOf('T') > -1
        ? date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
        : '';
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
  if (!query.trim()) {
    renderConcerts(allConcerts);
    return;
  }
  var q = query.toLowerCase();
  var filtered = allConcerts.filter(function(c) {
    return c.artist.toLowerCase().indexOf(q) > -1 ||
      c.venue.toLowerCase().indexOf(q) > -1 ||
      c.city.toLowerCase().indexOf(q) > -1 ||
      c.country.toLowerCase().indexOf(q) > -1;
  });
  renderConcerts(filtered);
}

function showToast(message) {
  var container = document.getElementById('toast-container');
  var toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = message + '<button class="toast-close" onclick="this.parentElement.remove()">✕</button>';
  container.appendChild(toast);
  setTimeout(function() { toast.remove(); }, 3000);
}
