let artists = [];
let artistPop = {};

const MOIS_FR = ["janv","févr","mars","avr","mai","juin","juil","août","sept","oct","nov","déc"];
const FAV_KEY = 'leet_favs';
window._concertStore = {};
let _favId = 0;

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}
function logout() { window.location.href = '/logout'; }
function changeAccount() { fetch('/logout').then(() => { window.location.href = '/login'; }); }

// === TIROIR FAVORIS ===
function toggleFavs(open) {
  document.getElementById('favs-drawer').classList.toggle('open', open);
  document.getElementById('favs-overlay').classList.toggle('open', open);
  if (open) renderFavsList();
}
function getFavs() { try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch (e) { return []; } }
function favKey(c) { return (c.name || '') + '|' + (c.venue || '') + '|' + (c.date || ''); }
function isFav(c) { const k = favKey(c); return getFavs().some(f => favKey(f) === k); }
function toggleFav(btn) {
  const c = window._concertStore[btn.dataset.fid];
  if (!c) return;
  let favs = getFavs();
  const k = favKey(c);
  if (favs.some(f => favKey(f) === k)) {
    favs = favs.filter(f => favKey(f) !== k);
    showToast('Retiré des favoris', 'info');
  } else {
    favs.push(c);
    showToast('Ajouté aux favoris ❤️', 'success');
  }
  localStorage.setItem(FAV_KEY, JSON.stringify(favs));
  syncFavButtons();
  updateFavsCount();
}
function syncFavButtons() {
  const keys = new Set(getFavs().map(favKey));
  document.querySelectorAll('.btn-fav').forEach(b => {
    const c = window._concertStore[b.dataset.fid];
    if (!c) return;
    const on = keys.has(favKey(c));
    b.textContent = on ? '❤️' : '🤍';
    b.classList.toggle('active', on);
  });
}
function updateFavsCount() {
  const el = document.getElementById('favs-count');
  if (el) el.textContent = getFavs().length;
  renderFavsList();
}
function renderFavsList() {
  const list = document.getElementById('favs-list');
  if (!list) return;
  const favs = getFavs();
  const el = document.getElementById('favs-count');
  if (el) el.textContent = favs.length;
  if (!favs.length) { list.innerHTML = '<p class="hint">Aucun favori pour l’instant. Clique sur 🤍 sur un concert.</p>'; return; }
  list.innerHTML = '';
  favs.forEach(f => {
    const d = document.createElement('div');
    d.className = 'fav-item';
    const date = formatDate(f.date);
    const ds = date ? `${date.day} ${date.month} ${date.year}` : 'date ?';
    d.innerHTML = `<b>${f.name}</b><span>${f.venue} — ${f.city}${f.country ? ', ' + f.country : ''} • ${ds}</span><div class="row">${f.url ? `<a href="${f.url}" target="_blank" rel="noopener">🎫 Billets</a>` : ''}<button onclick="removeFav('${encodeURIComponent(favKey(f))}')">Retirer ✕</button></div>`;
    list.appendChild(d);
  });
}
function removeFav(kEnc) {
  const k = decodeURIComponent(kEnc);
  let favs = getFavs().filter(f => favKey(f) !== k);
  localStorage.setItem(FAV_KEY, JSON.stringify(favs));
  syncFavButtons();
  renderFavsList();
}
function favButton(c) {
  const fid = 'c' + (_favId++);
  window._concertStore[fid] = c;
  const on = isFav(c);
  return `<button class="btn-fav${on ? ' active' : ''}" data-fid="${fid}" onclick="toggleFav(this)" title="Mettre en favori">${on ? '❤️' : '🤍'}</button>`;
}

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
function cardHtml(name, concert, badge) {
  const date = formatDate(concert.date);
  const monthHtml = date ? `<div class="concert-date-box"><div class="day">${date.day}</div><div class="month">${date.month}</div><div class="year">${date.year}</div></div>` : '<div class="concert-date-box"><div class="day">?</div></div>';
  const c = { name, venue: concert.venue, city: concert.city, country: concert.country, date: concert.date, url: concert.url };
  return `<div class="artist-section-header"><h3>${name}</h3>${badge || ''}</div><div class="concert-card">${monthHtml}<div class="concert-info"><div class="concert-venue">${concert.venue}</div><div class="concert-location">${concert.city}${concert.country ? ', ' + concert.country : ''}</div><div class="concert-tags"><span class="concert-tag source">${concert.source}</span></div></div><div class="concert-actions">${favButton(c)}${concert.url ? `<a class="btn-ticket" href="${concert.url}" target="_blank" rel="noopener">🎫 Billets</a>` : ''}</div></div>`;
}
function renderTopWorld(list) {
  const container = document.getElementById('concerts-container');
  list.forEach(r => {
    if (!r.concert) return;
    const s = document.createElement('div');
    s.className = 'artist-section';
    s.innerHTML = cardHtml(r.name, r.concert, '');
    container.appendChild(s);
  });
  syncFavButtons();
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
    const s = document.createElement('div');
    s.className = 'artist-section';
    s.innerHTML = cardHtml(r.name, r.concert, r.popularity ? `<span class="track-badge">Pop ${r.popularity}</span>` : '');
    container.appendChild(s);
  });
  _allRendered = results;
  syncFavButtons();
}
let _allRendered = [];
function filterConcerts(value) {
  const v = value.trim().toLowerCase();
  const container = document.getElementById('concerts-container');
  container.innerHTML = '';
  const filtered = _allRendered.filter(r => {
    if (!v) return true;
    if (v === 'favoris' || v === '❤️') return isFav({ name: r.name, venue: r.concert.venue, date: r.concert.date });
    return r.name.toLowerCase().includes(v) || (r.concert && r.concert.venue.toLowerCase().includes(v)) || (r.concert && r.concert.city.toLowerCase().includes(v));
  });
  filtered.forEach(r => {
    if (!r.concert) return;
    const s = document.createElement('div');
    s.className = 'artist-section';
    s.innerHTML = cardHtml(r.name, r.concert, r.popularity ? `<span class="track-badge">Pop ${r.popularity}</span>` : '');
    container.appendChild(s);
  });
  syncFavButtons();
}
(async function init() {
  updateFavsCount();
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
