let artists = [];
let artistPop = {};

const MOIS_FR = ["janv","févr","mars","avr","mai","juin","juil","août","sept","oct","nov","déc"];
const FAV_KEY = 'leet_favs';
const SEEN_KEY = 'leet_seen';
window._concertStore = {};
let _favId = 0;
let selectedRegion = 'ALL';
const CITY_TO_REGION = {
  'paris':'IDF','saint-denis':'IDF','nanterre':'IDF','creteil':'IDF','cergy':'IDF','evry':'IDF',
  'lyon':'ARA','grenoble':'ARA','saint-etienne':'ARA','clermont-ferrand':'ARA','annecy':'ARA','villeurbanne':'ARA',
  'marseille':'PAC','nice':'PAC','toulon':'PAC','aix-en-provence':'PAC','avignon':'PAC',
  'toulouse':'OCC','montpellier':'OCC','nimes':'OCC','perpignan':'OCC',
  'bordeaux':'NAQ','la rochelle':'NAQ','poitiers':'NAQ','limoges':'NAQ','pau':'NAQ',
  'lille':'HDF','amiens':'HDF','dunkerque':'HDF','valenciennes':'HDF',
  'strasbourg':'GES','metz':'GES','nancy':'GES','reims':'GES','amneville':'GES','amneville les thermes':'GES',
  'nantes':'PDL','angers':'PDL','rennes':'BRE','brest':'BRE',
  'rouen':'NOR','caen':'NOR','le havre':'NOR','dijon':'BFC','besancon':'BFC',
  'orleans':'CVL','tours':'CVL','ajaccio':'COR','bastia':'COR'
};
function cityToRegion(city) {
  const c = (city || '').toLowerCase().trim();
  if (CITY_TO_REGION[c]) return CITY_TO_REGION[c];
  for (const k in CITY_TO_REGION) { if (c.includes(k) || k.includes(c)) return CITY_TO_REGION[k]; }
  return null;
}
function selectRegion(r) {
  selectedRegion = r;
  document.querySelectorAll('.region-chip').forEach(b => b.classList.toggle('active', b.dataset.region === r));
  document.querySelectorAll('.fr-map-region').forEach(g => g.classList.toggle('active', g.dataset.region === r));
  applyFilters();
}
function applyFilters() {
  const country = (document.getElementById('country-filter') || {}).value || 'ALL';
  const fr = document.getElementById('fr-regions');
  if (fr) fr.style.display = country === 'FR' ? 'block' : 'none';
  const flag = document.getElementById('country-flag');
  if (flag) flag.textContent = country === 'FR' ? '🇫🇷' : '🌍';
  filterConcerts(document.getElementById('search-artist').value || '');
}

// === AGENT ALERTE ===
function getSeen() { try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'); } catch (e) { return []; } }
function markSeen(list) {
  const keys = new Set(getSeen());
  list.forEach(c => keys.add((c.name || '') + '|' + (c.venue || '') + '|' + (c.date || '')));
  localStorage.setItem(SEEN_KEY, JSON.stringify([...keys].slice(-500)));
}
function isNewConcert(name, cc) {
  return !getSeen().includes(name + '|' + cc.venue + '|' + cc.date);
}
async function agentCheck() {
  if (!artists.length) return;
  try {
    const res = await fetch('/api/multi-artist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artists })
    });
    if (!res.ok) return;
    const data = await res.json();
    const fresh = [];
    data.forEach(r => {
      (r.concerts || (r.concert ? [r.concert] : [])).forEach(cc => {
        if (cc.country === 'FR' && isNewConcert(r.name, cc)) fresh.push({ name: r.name, venue: cc.venue, date: cc.date });
      });
    });
    if (fresh.length) {
      showToast(`🔔 ${fresh.length} nouveau(x) concert(s) FR !`, 'success');
      markSeen(fresh);
    }
  } catch (e) {}
}
setInterval(agentCheck, 10 * 60 * 1000);

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}
function logout() { window.location.href = '/logout'; }
function changeAccount() { fetch('/logout').then(() => { window.location.href = '/login'; }); }
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
  if (favs.some(f => favKey(f) === k)) { favs = favs.filter(f => favKey(f) !== k); showToast('Retiré des favoris', 'info'); }
  else { favs.push(c); showToast('Ajouté aux favoris ❤️', 'success'); }
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
  localStorage.setItem(FAV_KEY, JSON.stringify(getFavs().filter(f => favKey(f) !== k)));
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
function getAllConcerts(r) {
  if (r.concerts && r.concerts.length) return r.concerts;
  if (r.concert) return [r.concert];
  return [];
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
  try {
    const res = await fetch('/api/multi-artist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artists })
    });
    if (res.ok) {
      const data = await res.json();
      (data || []).forEach(r => { results.push({ name: r.name, popularity: artistPop[r.name] || null, concerts: getAllConcerts(r) }); });
    }
  } catch (e) {}
  loading.style.display = 'none';
  const withConcerts = results.filter(r => r.concerts && r.concerts.length);
  if (!withConcerts.length) { noConcerts.style.display = 'block'; }
  else {
    _allRendered = withConcerts;
    applyFilters();
    const total = withConcerts.reduce((n, r) => n + r.concerts.length, 0);
    document.getElementById('alerts-count').textContent = total + ' concert' + (total > 1 ? 's' : '');
    document.getElementById('artist-summary').textContent = `${withConcerts.length} artistes • ${total} dates (France d'abord)`;
  }
  loadTopWorld();
  try {
    const all = [];
    _allRendered.forEach(r => (r.concerts || []).forEach(cc => all.push({ name: r.name, venue: cc.venue, date: cc.date })));
    markSeen(all);
  } catch (e) {}
}
async function loadTopWorld() {
  try {
    const res = await fetch('/api/top-world');
    if (!res.ok) return;
    const list = await res.json();
    _topWorldList = list || [];
    renderTopWorldFiltered();
  } catch (e) {}
}
let _topWorldList = [];
function renderTopWorldFiltered() {
  const country = (document.getElementById('country-filter') || {}).value || 'ALL';
  const container = document.getElementById('concerts-container');
  const filtered = (_topWorldList || []).map(r => {
    const concerts = getAllConcerts(r).filter(cc => {
      if (country === 'FR' && cc.country !== 'FR') return false;
      if (country === 'FR' && selectedRegion !== 'ALL' && cityToRegion(cc.city) !== selectedRegion) return false;
      return true;
    });
    return { name: r.name, concerts };
  }).filter(r => r.concerts.length);
  if (!filtered.length) return;
  const title = document.createElement('div');
  title.className = 'artist-section-header';
  title.style.marginTop = '30px';
  title.innerHTML = '<h3>Top monde 🌍</h3><span class="track-badge">Suggestions</span>';
  container.appendChild(title);
  renderTopWorld(filtered);
}
function concertCard(name, concert) {
  const date = formatDate(concert.date);
  const monthHtml = date ? `<div class="concert-date-box"><div class="day">${date.day}</div><div class="month">${date.month}</div><div class="year">${date.year}</div></div>` : '<div class="concert-date-box"><div class="day">?</div></div>';
  const c = { name, venue: concert.venue, city: concert.city, country: concert.country, date: concert.date, url: concert.url };
  const isNew = isNewConcert(name, concert);
  return `<div class="concert-card">${monthHtml}<div class="concert-info"><div class="concert-venue">${concert.venue}</div><div class="concert-location">${concert.city}${concert.country ? ', ' + concert.country : ''}</div><div class="concert-tags"><span class="concert-tag source">${concert.source}</span>${concert.country === 'FR' ? '<span class="concert-tag">🇫🇷 France</span>' : ''}${isNew ? '<span class="concert-tag new-tag">🔔 NOUVEAU</span>' : ''}</div></div><div class="concert-actions">${favButton(c)}${concert.url ? `<a class="btn-ticket" href="${concert.url}" target="_blank" rel="noopener">🎫 Billets</a>` : ''}</div></div>`;
}
function renderTopWorld(list) {
  const container = document.getElementById('concerts-container');
  list.forEach(r => {
    const concerts = r.concerts || getAllConcerts(r);
    if (!concerts.length) return;
    const s = document.createElement('div');
    s.className = 'artist-section';
    let html = `<div class="artist-section-header"><h3>${r.name}</h3><span class="track-badge">${concerts.length} date${concerts.length > 1 ? 's' : ''}</span></div>`;
    concerts.forEach(cc => { html += concertCard(r.name, cc); });
    s.innerHTML = html;
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
    const concerts = r.concerts || [];
    if (!concerts.length) return;
    const s = document.createElement('div');
    s.className = 'artist-section';
    let html = `<div class="artist-section-header"><h3>${r.name}</h3><span class="track-badge">${concerts.length} date${concerts.length > 1 ? 's' : ''}</span></div>`;
    concerts.forEach(cc => { html += concertCard(r.name, cc); });
    s.innerHTML = html;
    container.appendChild(s);
  });
  _allRendered = results;
  syncFavButtons();
}
let _allRendered = [];
function matchCountry(cc) {
  const country = (document.getElementById('country-filter') || {}).value || 'ALL';
  if (country === 'FR' && cc.country !== 'FR') return false;
  if (country === 'FR' && selectedRegion !== 'ALL' && cityToRegion(cc.city) !== selectedRegion) return false;
  return true;
}
function filterConcerts(value) {
  const v = (value || '').trim().toLowerCase();
  const container = document.getElementById('concerts-container');
  container.innerHTML = '';
  const filtered = _allRendered.filter(r => {
    if (v === 'favoris' || v === '❤️') return (r.concerts || []).some(cc => matchCountry(cc) && isFav({ name: r.name, venue: cc.venue, date: cc.date }));
    if (v && !r.name.toLowerCase().includes(v)) {
      const anyVenue = (r.concerts || []).some(cc => cc.venue.toLowerCase().includes(v) || cc.city.toLowerCase().includes(v));
      if (!anyVenue) return false;
    }
    return (r.concerts || []).some(matchCountry);
  });
  filtered.forEach(r => {
    const concerts = (r
