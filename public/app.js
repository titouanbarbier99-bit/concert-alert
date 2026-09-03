let spotifyToken = null;
let allConcerts = [];
let allArtists = [];
let selectedPlaylistIds = [];
let pollingInterval = null;

// ═══════ INIT ═══════

document.addEventListener('DOMContentLoaded', () => {
  const hash = window.location.hash;
  const params = new URLSearchParams(window.location.search);

  if (hash === '#authenticated' || params.has('token')) {
    spotifyToken = params.get('token');
    window.history.replaceState({}, '', '/');
    showScreen('screen-playlists');
    loadPlaylists();
  } else {
    showScreen('screen-login');
  }
});

function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
}

// ═══════ PLAYLISTS ═══════

async function loadPlaylists() {
  const loading = document.getElementById('playlists-loading');
  const grid = document.getElementById('playlists-grid');
  loading.style.display = 'flex';
  grid.innerHTML = '';

  try {
    const res = await fetch(`/api/playlists?token=${encodeURIComponent(spotifyToken)}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    loading.style.display = 'none';
    for (const pl of data.playlists) {
      const card = document.createElement('div');
      card.className = 'playlist-card';
      card.dataset.id = pl.id;
      card.onclick = () => togglePlaylist(pl.id, card);
      card.innerHTML = `
        ${pl.image
          ? `<img class="playlist-img" src="${pl.image}" alt="${pl.name}">`
          : `<div class="playlist-img-placeholder">🎶</div>`
        }
        <div class="playlist-info">
          <div class="playlist-name">${pl.name}</div>
          <div class="playlist-meta">${pl.trackCount} morceaux · ${pl.owner}</div>
        </div>
      `;
      grid.appendChild(card);
    }
  } catch (err) {
    loading.innerHTML = `<p style="color:var(--danger)">Erreur: ${err.message}</p>`;
  }
}

function togglePlaylist(id, card) {
  if (selectedPlaylistIds.includes(id)) {
    selectedPlaylistIds = selectedPlaylistIds.filter(i => i !== id);
    card.classList.remove('selected');
  } else {
    selectedPlaylistIds.push(id);
    card.classList.add('selected');
  }
  updateAnalyzeButton();
}

function updateAnalyzeButton() {
  let bar = document.getElementById('analyze-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'analyze-bar';
    bar.className = 'playlist-select-bar';
    bar.innerHTML = `
      <button class="btn-analyze" id="btn-analyze" onclick="analyzePlaylists()" disabled>
        Analyser les artistes
      </button>
      <span id="selected-count" style="color:var(--text-dim);font-size:14px"></span>
    `;
    document.querySelector('#screen-playlists .content').appendChild(bar);
  }
  const btn = bar.querySelector('#btn-analyze');
  const count = bar.querySelector('#selected-count');
  btn.disabled = selectedPlaylistIds.length === 0;
  count.textContent = selectedPlaylistIds.length > 0
    ? `${selectedPlaylistIds.length} playlist${selectedPlaylistIds.length > 1 ? 's' : ''} sélectionnée${selectedPlaylistIds.length > 1 ? 's' : ''}`
    : '';
}

// ═══════ ARTIST EXTRACTION ═══════

async function analyzePlaylists() {
  showScreen('screen-alerts');
  const loading = document.getElementById('artists-loading');
  const container = document.getElementById('concerts-container');
  const noConcerts = document.getElementById('no-concerts');
  loading.style.display = 'flex';
  container.innerHTML = '';
  noConcerts.style.display = 'none';

  const artistsMap = new Map();

  for (let i = 0; i < selectedPlaylistIds.length; i++) {
    const plId = selectedPlaylistIds[i];
    const progress = document.getElementById('progress-fill');
    progress.style.width = `${((i) / selectedPlaylistIds.length) * 50}%`;
    try {
      const res = await fetch(`/api/playlists/${plId}/artists?token=${encodeURIComponent(spotifyToken)}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      for (const artist of data.artists) {
        if (artistsMap.has(artist.id)) {
          artistsMap.get(artist.id).trackCount += artist.trackCount;
        } else {
          artistsMap.set(artist.id, artist);
        }
      }
    } catch (err) {
      console.error('Error loading playlist artists:', err);
    }
  }

  allArtists = Array.from(artistsMap.values()).sort((a, b) => b.trackCount - a.trackCount);
  document.getElementById('artist-summary').textContent = `${allArtists.length} artistes uniques détectés`;
  document.getElementById('alerts-count').textContent = '';

  const artistNames = allArtists.map(a => a.name).join(',');
  document.getElementById('progress-fill').style.width = '60%';

  try {
    const res = await fetch(`/api/concerts?artists=${encodeURIComponent(artistNames)}`);
    const data = await res.json();
    allConcerts = data.concerts || [];
    document.getElementById('progress-fill').style.width = '100%';
    setTimeout(() => { loading.style.display = 'none'; }, 500);
    renderConcerts(allConcerts);
    startPolling(artistNames);
    requestNotificationPermission();
  } catch (err) {
    loading.innerHTML = `<p style="color:var(--danger)">Erreur lors de la recherche de concerts: ${err.message}</p>`;
  }
}

// ═══════ RENDER ═══════

function renderConcerts(concerts) {
  const container = document.getElementById('concerts-container');
  const noConcerts = document.getElementById('no-concerts');
  container.innerHTML = '';

  if (concerts.length === 0) {
    noConcerts.style.display = 'block';
    document.getElementById('alerts-count').textContent = '0 concerts';
    return;
  }
  noConcerts.style.display = 'none';
  document.getElementById('alerts-count').textContent = `${concerts.length} concert${concerts.length > 1 ? 's' : ''}`;

  const grouped = {};
  for (const concert of concerts) {
    if (!grouped[concert.artist]) grouped[concert.artist] = [];
    grouped[concert.artist].push(concert);
  }

  for (const [artist, artistConcerts] of Object.entries(grouped)) {
    const section = document.createElement('div');
    section.className = 'artist-section';
    const artistData = allArtists.find(a => a.name === artist);
    section.innerHTML = `
      <div class="artist-section-header">
        <h3>${artist}</h3>
        <span class="track-badge">${artistData?.trackCount || '?'} morceaux</span>
      </div>
    `;
    for (const c of artistConcerts) {
      const date = new Date(c.date);
      const day = date.getDate();
      const month = date.toLocaleDateString('fr-FR', { month: 'short' });
      const year = date.getFullYear();
      const fullDate = date.toLocaleDateString('fr-FR', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
      const location = [c.city, c.country].filter(Boolean).join(', ');

      const card = document.createElement('div');
      card.className = 'concert-card';
      card.innerHTML = `
        <div class="concert-date-box">
          <div class="day">${day}</div>
          <div class="month">${month}</div>
          <div class="year">${year}</div>
        </div>
        <div class="concert-info">
          <div class="concert-venue">${c.venue}</div>
          <div class="concert-location">${location}</div>
          <div class="concert-tags">
            <span class="concert-tag">📅 ${fullDate}</span>
          </div>
        </div>
        <div class="concert-actions">
          ${c.ticketUrl ? `<a href="${c.ticketUrl}" target="_blank" class="btn-ticket">🎫 Réserver</a>` : ''}
        </div>
      `;
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
  const q = query.toLowerCase();
  const filtered = allConcerts.filter(c =>
    c.artist.toLowerCase().includes(q) ||
    c.venue.toLowerCase().includes(q) ||
    c.city.toLowerCase().includes(q) ||
    c.country.toLowerCase().includes(q)
  );
  renderConcerts(filtered);
}

// ═══════ POLLING ═══════

function startPolling(artistNames) {
  if (pollingInterval) clearInterval(pollingInterval);
  pollingInterval = setInterval(async () => {
    try {
      const res = await fetch(`/api/concerts?artists=${encodeURIComponent(artistNames)}`);
      const data = await res.json();
      const newConcerts = data.concerts || [];
      if (newConcerts.length > allConcerts.length) {
        const newOnes = newConcerts.filter(nc =>
          !allConcerts.some(oc => oc.artist === nc.artist && oc.date === nc.date && oc.venue === nc.venue)
        );
        allConcerts = newConcerts;
        renderConcerts(allConcerts);
        for (const nc of newOnes) {
          showToast(`🎤 Nouveau concert: ${nc.artist} - ${nc.venue} le ${new Date(nc.date).toLocaleDateString('fr-FR')}`);
          sendNotification(`Nouveau concert: ${nc.artist}`, `${nc.venue} - ${new Date(nc.date).toLocaleDateString('fr-FR')}`);
        }
      }
    } catch (e) {}
  }, 5 * 60 * 1000);
}

// ═══════ NOTIFICATIONS ═══════

function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function sendNotification(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body, icon: '🎵' });
  }
}

// ═══════ TOAST ═══════

function showToast(message) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `${message}<button class="toast-close" onclick="this.parentElement.remove()">✕</button>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 8000);
}

// ═══════ MODAL ═══════

function openModal(html) {
  document.getElementById('modal-content').innerHTML = html;
  document.getElementById('modal-overlay').classList.add('open');
}
function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
}

// ═══════ LOGOUT ═══════

function logout() {
  if (pollingInterval) clearInterval(pollingInterval);
  spotifyToken = null;
  allConcerts = [];
  allArtists = [];
  selectedPlaylistIds = [];
  showScreen('screen-login');
  const analyzeBar = document.getElementById('analyze-bar');
  if (analyzeBar) analyzeBar.remove();
}
