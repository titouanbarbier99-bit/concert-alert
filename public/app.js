let artists = [];
let artistPop = {};

const MOIS_FR = ["janv","févr","mars","avr","mai","juin","juil","août","sept","oct","nov","déc"];

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}
function logout() { window.location.href = '/logout'; }
function changeAccount() { fetch('/logout').then(() => { window.location.href = '/login'; }); }
function showToast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = 'toast';
  let icon = 'ℹ️';
  if (type === 'success') icon = '✅';
  if (type === 'error') icon = '❌';
  t.innerHTML = `<span>${icon}</span><span>${msg}</span><button class="toast-close" onclick="this.parentElement.remove()">✕</button>`;
  document.getElementById('toast-container').appendChild(t);
  setTimeout(() => t.remove(), 5000);
}
function updateArtistCount() {
  const el = document.getElementById('artist-count');
  if (el) el.textContent = `${artists.length} artiste${artists.length > 1 ? 's' : ''}`;
}
function renderTags() {
  const tags = document.getElementById('artist-tags');
  tags.innerHTML = '';
  artists.forEach((a, i) => {
    const t = document.createElement('span');
    t.className = 'artist-tag';
    t.innerHTML = `${a}<button onclick="removeArtist(${i})">✕</button>`;
    tags.appendChild(t);
  });
}
function addArtist() {
  const input = document.getElementById('artist-input');
  const name = input.value.trim();
  if (!name) return;
  if (!artists.includes(name)) { artists.push(name); renderTags(); }
  input.value = '';
  document.getElementById('btn-search').disabled = artists.length === 0;
  updateArtistCount();
}
function addArtistDirect(name) {
  if (!artists.includes(name)) { artists.push(name); renderTags(); }
  document.getElementById('btn-search').disabled = artists.length === 0;
  updateArtistCount();
}
function removeArtist(i) {
  artists.splice(i, 1);
  renderTags();
  document.getElementById('btn-search').disabled = artists.length === 0;
  updateArtistCount();
}
async function searchConcerts() {
  if (artists.length === 0) return;
  showScreen('screen-alerts');
  const loading = document.getElementById('artists-loading');
  const container = document.getElementById('concerts-container');
  const noConcerts = document.getElementById('no-concerts');
  loading.style.display = 'flex';
  container.innerHTML = '';
  noConcerts.style.display = 'none';
  const results = [];
  const ticketByName = new Map();
  try {
    const res = await fetch('/api/multi-artist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artists })
    });
    if (res.ok) {
      const data = await res.json();
      (data || []).forEach(r => { if (r && r.concert) ticketByName.set(r.name, r); });
    }
  } catch (e) {}
  for (const name of artists) {
    const tm = ticketByName.get(name);
    if (!tm) { results.push({ name, popularity: artistPop[name] || null, concert: null }); continue; }
    results.push({ name, popularity: artistPop[name] || null, concert: tm.concert });
  }
  loading.style.display = 'none';
  const withConcerts = results.filter(r => r.concert);
  if (withConcerts.length === 0) { noConcerts.style.display = 'block'; }
  else {
    withConcerts.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    renderConcerts(withConcerts);
    document.getElementById('alerts-count').textContent = withConcerts.length + ' concert' + (withConcerts.length > 1 ? 's' : '');
  }
  loadTopWorld();
}
async function loadTopWorld() {
  const container = document.getElementById('concerts-container');
  try {
    const res = await fetch('/api/top-world');
    if (!res.ok) return;
    const list = await res.json();
    if (!list || !list.length) return;
    const title = document.createElement('div');
    title.className = 'artist-section-header';
    title.style.marginTop = '30px';
    title.innerHTML = '<h3>Top monde 🌍</h3><span class="track-badge">Suggestions</span>';
    container.appendChild(title);
    renderTopWorld(list);
  } catch (e) {}
}
function renderTopWorld(list) {
  const container = document.getElementById('concerts-container');
  list.forEach(r => {
    if (!r.concert) return;
    const date = formatDate(r.concert.date);
    const monthHtml = date ? `<div class="concert-date-box"><div class="day">${date.day}</div><div class="month">${date.month}</div><div class="year">${date.year}</div></div>` : '<div class="concert-date-box"><div class="day">?</div></div>';
    const s = document.createElement('div');
    s.className = 'artist-section';
    s.innerHTML = `<div class="artist-section-header"><h3>${r.name}</h3></div><div class="concert-card">${monthHtml}<div class="concert-info"><div class="concert-venue">${r.concert.venue}</div><div class="concert-location">${r.concert.city}${r.concert.country ? ', ' + r.concert.country : ''}</div><div class="concert-tags"><span class="concert-tag source">${r.concert.source}</span></div></div>${r.concert.url ? `<div class="concert-actions"><a class="btn-ticket" href="${r.concert.url}" target="_blank" rel="noopener">🎫 Billets</a></div>` : ''}</div>`;
    container.appendChild(s);
  });
}
function formatDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return { day: d.getDate(), month: MOIS_FR[d.getMonth()], year: d.getFullYear() };
}
function renderConcerts(results) {
  const container = document.getElementById('concerts-container');
  container.innerHTML = '';
  results.forEach(r => {
    if (!r.concert) return;
    const date = formatDate(r.concert.date);
    const monthHtml = date ? `<div class="concert-date-box"><div class="day">${date.day}</div><div class="month">${date.month}</div><div class="year">${date.year}</div></div>` : '<div class="concert-date-box"><div class="day">?</div></div>';
    const section = document.createElement('div');
    section.className = 'artist-section';
    section.innerHTML = `<div class="artist-section-header"><h3>${r.name}</h3>${r.popularity ? `<span class="track-badge">Pop ${r.popularity}</span>` : ''}</div><div class="concert-card">${monthHtml}<div class="concert-info"><div class="concert-venue">${r.concert.venue}</div><div class="concert-location">${r.concert.city}${r.concert.country ? ', ' + r.concert.country : ''}</div><div class="concert-tags"><span class="concert-tag source">${r.concert.source}</span></div></div>${r.concert.url ? `<div class="concert-actions"><a class="btn-ticket" href="${r.concert.url}" target="_blank" rel="noopener">🎫 Billets</a></div>` : ''}</div>`;
    container.appendChild(section);
  });
  _allRendered = results;
}
let _allRendered = [];
function filterConcerts(value) {
  const v = value.trim().toLowerCase();
  const container = document.getElementById('concerts-container');
  container.innerHTML = '';
  const filtered = _allRendered.filter(r => {
    if (!v) return true;
    return r.name.toLowerCase().includes(v) || (r.concert && r.concert.venue.toLowerCase().includes(v)) || (r.concert && r.concert.city.toLowerCase().includes(v));
  });
  filtered.forEach(r => {
    if (!r.concert) return;
    const date = formatDate(r.concert.date);
    const monthHtml = date ? `<div class="concert-date-box"><div class="day">${date.day}</div><div class="month">${date.month}</div><div class="year">${date.year}</div></div>` : '<div class="concert-date-box"><div class="day">?</div></div>';
    const s = document.createElement('div');
    s.className = 'artist-section';
    s.innerHTML = `<div class="artist-section-header"><h3>${r.name}</h3>${r.popularity ? `<span class="track-badge">Pop ${r.popularity}</span>` : ''}</div><div class="concert-card">${monthHtml}<div class="concert-info"><div class="concert-venue">${r.concert.venue}</div><div class="concert-location">${r.concert.city}${r.concert.country ? ', ' + r.concert.country : ''}</div><div class="concert-tags"><span class="concert-tag source">${r.concert.source}</span></div></div>${r.concert.url ? `<div class="concert-actions"><a class="btn-ticket" href="${r.concert.url}" target="_blank" rel="noopener">🎫 Billets</a></div>` : ''}</div>`;
    container.appendChild(s);
  });
}
(async function init() {
  try {
    const me = await fetch('/api/me');
    const m = await me.json();
    if (m.authenticated) {
      const r = await fetch('/api/my-artists');
      const my = await r.json();
      artistPop = my.popMap || {};
      if (my.artists && my.artists.length) {
        artists = my.artists;
        renderTags();
        document.getElementById('btn-search').disabled = false;
        updateArtistCount();
        document.getElementById('artist-summary').textContent = `${my.artists.length} artistes importés depuis ton Spotify`;
        searchConcerts();
      } else { showScreen('screen-artists'); }
    } else { showScreen('screen-login'); }
  } catch (e) { showScreen('screen-login'); }
})();
