let artists = [];
let artistPop = {};


const MOIS_FR = ["janv","févr","mars","avr","mai","juin","juil","août","sept","oct","nov","déc"];
const FAV_KEY = 'leet_favs';
window._concertStore = {};
let _favId = 0;
let selectedRegion = 'ALL';
window._a4Removed = 0;
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
function normTxt(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}
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
  const now = Date.now();
  const withDays = favs.map(f => {
    const d = new Date(f.date);
    const days = isNaN(d) ? 9999 : Math.ceil((d.getTime() - now) / 86400000);
    return { f, days };
  }).sort((a, b) => a.days - b.days);
  const soon = withDays.filter(x => x.days >= 0 && x.days <= 7);
  list.innerHTML = '';
  if (soon.length) {
    const alert = document.createElement('div');
    alert.className = 'fav-item fav-soon';
    alert.innerHTML = `<b>⏰ ${soon.length} concert(s) dans 7 jours !</b><span>${soon.map(x => `${x.f.name} (J-${x.days})`).join(' • ')}</span>`;
    list.appendChild(alert);
  }
  withDays.forEach(({ f, days }) => {
    const d = document.createElement('div');
    d.className = 'fav-item';
    d.dataset.fkey = encodeURIComponent(favKey(f));
    const date = formatDate(f.date);
    const ds = date ? `${date.day} ${date.month} ${date.year}` : 'date ?';
    const tag = days < 0 ? '✅ passé' : days === 0 ? "🔥 aujourd'hui" : days === 1 ? '🔥 demain' : `⏳ J-${days}`;
    d.innerHTML = `<b>${f.name}</b><span>${f.venue} — ${f.city}${f.country ? ', ' + f.country : ''} • ${ds} • ${tag}</span><div class="row">${f.url ? `<a href="${f.url}" target="_blank" rel="noopener">🎫 Billets</a>` : ''}<button onclick="removeFav('${encodeURIComponent(favKey(f))}')">Retirer ✕</button></div>`;
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

/* AGENT 4 : ANTI-DOUBLONS */
function dedupeConcerts(list) {
  const out = [];
  const seenDayVenue = new Set();
  const seenDayCity = new Set();
  const seenUrl = new Set();
  (list || []).forEach(c => {
    if (!c || !c.date) return;
    const day = String(c.date).slice(0, 10);
    const venue = normTxt(c.venue);
    const city = normTxt(c.city);
    const url = normTxt(c.url);
    const k1 = day + '|' + venue + '|' + city;
    const k2 = day + '|' + city;
    if (seenDayVenue.has(k1)) { window._a4Removed++; return; }
    if (city && seenDayCity.has(k2)) { window._a4Removed++; return; }
    if (url && seenUrl.has(url)) { window._a4Removed++; return; }
    seenDayVenue.add(k1);
    if (city) seenDayCity.add(k2);
    if (url) seenUrl.add(url);
    out.push(c);
  });
  out.sort((a, b) => {
    const fa = a.country === 'FR' ? 0 : 1;
    const fb = b.country === 'FR' ? 0 : 1;
    if (fa !== fb) return fa - fb;
    return String(a.date || '').localeCompare(String(b.date || ''));
  });
  return out;
}

function getAllConcerts(r) {
  if (r.concerts && r.concerts.length) return dedupeConcerts(r.concerts);
  if (r.concert) return dedupeConcerts([r.concert]);
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
  window._a4Removed = 0;
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
    let txt = `${withConcerts.length} artistes • ${total} dates (France d'abord)`;
    if (window._a4Removed > 0) txt += ` • ${window._a4Removed} doublon(s) retiré(s)`;
    document.getElementById('artist-summary').textContent = txt;
  }
  loadTopWorld();
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
  let isNew = false;
  if (typeof window.leetMarkSeen === 'function') isNew = window.leetMarkSeen(c);
  return `<div class="concert-card">${monthHtml}<div class="concert-info"><div class="concert-venue">${concert.venue}</div><div class="concert-location">${concert.city}${concert.country ? ', ' + concert.country : ''}</div><div class="concert-tags"><span class="concert-tag source">${concert.source}</span>${isNew ? '<span class="concert-tag" style="background:linear-gradient(135deg,#ff8a2e,#ff6a00);color:#fff;border:0">✨ Nouveau</span>' : ''}${concert.country === 'FR' ? '<span class="concert-tag">🇫🇷 France</span>' : ''}</div></div><div class="concert-actions">${favButton(c)}${concert.url ? `<a class="btn-ticket" href="${concert.url}" target="_blank" rel="noopener">🎫 Billets</a>` : ''}</div></div>`;
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
    const concerts = (r.concerts || []).filter(cc => {
      if (!matchCountry(cc)) return false;
      if (!v || v === 'favoris' || v === '❤️') return true;
      if (r.name.toLowerCase().includes(v)) return true;
      return cc.venue.toLowerCase().includes(v) || cc.city.toLowerCase().includes(v);
    });
    if (!concerts.length) return;
    const s = document.createElement('div');
    s.className = 'artist-section';
    let html = `<div class="artist-section-header"><h3>${r.name}</h3><span class="track-badge">${concerts.length} date${concerts.length > 1 ? 's' : ''}</span></div>`;
    concerts.forEach(cc => { html += concertCard(r.name, cc); });
    s.innerHTML = html;
    container.appendChild(s);
  });
  syncFavButtons();
  renderTopWorldFiltered();
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

/* ==========================================================
   AGENT 2 : NOUVEAUTÉS DEPUIS TA DERNIÈRE VISITE
   ========================================================== */
(function () {
  if (window.__agent2) return;
  window.__agent2 = true;

  var KEY = 'leet_seen';
  var snapshot = {};
  try { snapshot = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { snapshot = {}; }
  if (!window._a2new) window._a2new = new Set();

  window.leetMarkSeen = function (c) {
    try {
      var k = (c.name || '') + '|' + (c.venue || '') + '|' + (c.date || '');
      var isNew = !snapshot[k];
      if (isNew) window._a2new.add(k);
      var store = {};
      try { store = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e2) { store = {}; }
      store[k] = Date.now();
      snapshot[k] = Date.now();
      clearTimeout(window.__a2t);
      window.__a2t = setTimeout(function () {
        try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e3) {}
      }, 800);
      return isNew;
    } catch (e) { return false; }
  };

  function renderBanner() {
    var host = document.getElementById('concerts-container');
    if (!host) return;
    if (document.getElementById('a2-banner')) return;
    var n = window._a2new.size;
    if (!n) return;
    var box = document.createElement('div');
    box.id = 'a2-banner';
    box.style.cssText = 'margin:0 0 16px;padding:12px 14px;border-radius:16px;background:linear-gradient(135deg,rgba(255,138,46,.18),rgba(255,255,255,.7));border:1px solid rgba(255,138,46,.4);font-size:13px;font-weight:700;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)';
    box.innerHTML = '✨ <b>' + n + ' nouveau(x) concert' + (n > 1 ? 's' : '') + '</b> depuis ta dernière visite';
    host.insertBefore(box, host.firstChild);
  }

  new MutationObserver(renderBanner).observe(document.body, { childList: true, subtree: true });
})();

/* ==========================================================
   AGENT 1 : CALENDRIER (.ics)
   ========================================================== */
(function () {
  if (window.__agent1) return;
  window.__agent1 = true;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/\\/g, '\\\\').replace(/;/g, '\\;')
      .replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  }
  function stamp(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }
  function buildIcs(favs) {
    var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LEET//Concerts//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    var now = stamp(new Date().toISOString());
    var uid = Date.now().toString(36);
    favs.forEach(function (f, i) {
      var start = stamp(f.date);
      if (!start) return;
      var d = new Date(f.date);
      d.setHours(d.getHours() + 3);
      var end = stamp(d.toISOString());
      lines.push('BEGIN:VEVENT');
      lines.push('UID:leet-' + uid + '-' + i + '@leet');
      lines.push('DTSTAMP:' + now);
      lines.push('DTSTART:' + start);
      lines.push('DTEND:' + end);
      lines.push('SUMMARY:' + esc(f.name));
      lines.push('LOCATION:' + esc([f.venue, f.city, f.country].filter(Boolean).join(', ')));
      lines.push('DESCRIPTION:' + esc('Concert LEET' + (f.url ? ' — Billets : ' + f.url : '')));
      if (f.url) lines.push('URL:' + f.url);
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }
  function download(favs, filename) {
    if (!favs.length) { showToast('Aucun favori à ajouter', 'info'); return; }
    var blob = new Blob([buildIcs(favs)], { type: 'text/calendar;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    showToast(favs.length + ' concert(s) exporté(s) 📅', 'success');
  }
  window.leetExportAll = function () {
    var favs = getFavs().filter(function (f) { return !isNaN(new Date(f.date)); });
    download(favs, 'concerts-leet.ics');
  };
  window.leetExportOne = function (keyEnc) {
    var k = decodeURIComponent(keyEnc);
    var fav = getFavs().filter(function (f) { return favKey(f) === k; })[0];
    if (!fav) return;
    download([fav], 'leet-' + (fav.name || 'concert').replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.ics');
  };

  function ensureButtons() {
    var list = document.getElementById('favs-list');
    if (!list || !list.parentNode) return;
    if (!document.getElementById('a1-all')) {
      var b = document.createElement('button');
      b.id = 'a1-all';
      b.type = 'button';
      b.textContent = '📅 Tout ajouter à mon agenda';
      b.style.cssText = 'display:block;width:calc(100% - 28px);margin:12px 14px;padding:12px;border-radius:16px;border:1px solid rgba(255,138,46,.45);background:linear-gradient(135deg,rgba(255,138,46,.2),rgba(255,255,255,.75));font-weight:800;font-size:13px;cursor:pointer;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)';
      b.onclick = function () { window.leetExportAll(); };
      list.parentNode.insertBefore(b, list);
    }
    Array.prototype.forEach.call(list.querySelectorAll('.fav-item'), function (item) {
      if (item.classList.contains('fav-soon')) return;
      if (item.querySelector('.a1-one')) return;
      var key = item.dataset.fkey;
      if (!key) return;
      var row = item.querySelector('.row') || item;
      var a = document.createElement('button');
      a.type = 'button';
      a.className = 'a1-one';
      a.textContent = '📅';
      a.title = 'Ajouter au calendrier';
      a.style.cssText = 'margin-right:8px;padding:6px 10px;border-radius:10px;border:1px solid rgba(0,0,0,.08);background:rgba(255,255,255,.7);cursor:pointer;font-size:12px';
      a.onclick = function () { window.leetExportOne(key); };
      row.insertBefore(a, row.firstChild);
    });
  }

  new MutationObserver(ensureButtons).observe(document.body, { childList: true, subtree: true });
})();

/* ==========================================================
   AGENT 3 : WEEKEND INTELLIGENT
   ========================================================== */
(function () {
  if (window.__agent3) return;
  window.__agent3 = true;

  var A3_NAMES = {
    IDF: "Île-de-France", ARA: "Auvergne-Rhône-Alpes", PAC: "Provence-Alpes-Côte d'Azur",
    OCC: "Occitanie", NAQ: "Nouvelle-Aquitaine", HDF: "Hauts-de-France",
    GES: "Grand Est", PDL: "Pays de la Loire", BRE: "Bretagne", NOR: "Normandie",
    BFC: "Bourgogne-Franche-Comté", CVL: "Centre-Val de Loire", COR: "Corse"
  };
  var A3_FALLBACK = {
    "paris": "IDF", "lyon": "ARA", "grenoble": "ARA", "saint-etienne": "ARA",
    "clermont-ferrand": "ARA", "annecy": "ARA", "villeurbanne": "ARA",
    "marseille": "PAC", "nice": "PAC", "toulon": "PAC", "aix-en-provence": "PAC", "avignon": "PAC",
    "toulouse": "OCC", "montpellier": "OCC", "nimes": "OCC", "perpignan": "OCC",
    "bordeaux": "NAQ", "la rochelle": "NAQ", "poitiers": "NAQ", "limoges": "NAQ", "pau": "NAQ",
    "lille": "HDF", "amiens": "HDF", "dunkerque": "HDF", "valenciennes": "HDF",
    "strasbourg": "GES", "metz": "GES", "nancy": "GES", "reims": "GES",
    "nantes": "PDL", "angers": "PDL", "le mans": "PDL",
    "rennes": "BRE", "brest": "BRE",
    "rouen": "NOR", "caen": "NOR", "le havre": "NOR",
    "dijon": "BFC", "besancon": "BFC",
    "orleans": "CVL", "tours": "CVL",
    "ajaccio": "COR", "bastia": "COR"
  };
  function a3Key(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
  function a3City(f) {
    if (!f) return "";
    if (f.city) return f.city;
    if (f.venue && f.venue.city) return f.venue.city;
    return "";
  }
  function a3Date(f) { return f ? String(f.date || "").slice(0, 10) : ""; }
  function a3Region(city) {
    var c = a3Key(city).trim();
    if (typeof cityToRegion === "function") {
      var r = cityToRegion(city);
      if (r) return r;
    }
    return A3_FALLBACK[c] || null;
  }
  function a3RegionName(code) { return A3_NAMES[code] || code; }
  function a3Saturday(dateStr) {
    var d = new Date(String(dateStr) + "T12:00:00");
    if (isNaN(d.getTime())) return null;
    d.setDate(d.getDate() + (6 - d.getDay()));
    var p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  function renderWeekendAgent() {
    var host = document.getElementById("favs-list");
    if (!host) return;
    if (document.getElementById("weekend-agent")) return;
    var favs = [];
    try { favs = JSON.parse(localStorage.getItem("leet_favs") || "[]"); } catch (e) { return; }
    if (!Array.isArray(favs) || favs.length < 2) return;

    var groups = {};
    favs.forEach(function (f) {
      var region = a3Region(a3City(f));
      var sat = a3Saturday(a3Date(f));
      if (!region || !sat) return;
      var k = region + "||" + sat;
      if (!groups[k]) groups[k] = [];
      groups[k].push(f);
    });
    var alerts = Object.keys(groups).map(function (k) { return groups[k]; }).filter(function (g) {
      var cities = {};
      g.forEach(function (x) { cities[a3Key(a3City(x))] = 1; });
      return g.length >= 2 && Object.keys(cities).length >= 2;
    });
    if (!alerts.length) return;

    var fmt = function (s) {
      var d = new Date(s + "T12:00:00");
      return isNaN(d.getTime()) ? s : d.toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
    };
    var box = document.createElement("div");
    box.id = "weekend-agent";
    box.style.cssText = "margin:0 0 12px;padding:14px;border-radius:18px;background:linear-gradient(135deg,rgba(255,138,46,.16),rgba(255,255,255,.7));border:1px solid rgba(255,138,46,.4);box-shadow:0 8px 24px rgba(255,138,46,.15);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)";
    var html = '<div style="font-weight:800;font-size:13px;display:flex;align-items:center;gap:7px">📅 Agent Weekend</div>';
    alerts.forEach(function (g) {
      var cities = [];
      g.forEach(function (x) { var c = a3City(x); if (c && cities.indexOf(c) < 0) cities.push(c); });
      var dates = Array.from(new Set(g.map(a3Date).filter(Boolean))).sort();
      html += '<div style="margin-top:9px;font-size:13px;line-height:1.5">'
        + '<b>Weekend du ' + fmt(dates[0]) + '</b> · ' + a3RegionName(a3Region(a3City(g[0]))) + '<br>'
        + cities.length + ' concerts / ' + cities.length + ' villes : ' + cities.join(" → ")
        + '<br><span style="opacity:.72;font-size:12px">Trajet probable : ' + cities[0] + ' → ' + cities[cities.length - 1] + '</span>'
        + '</div>';
    });
    box.innerHTML = html;
    host.insertBefore(box, host.firstChild);
  }

  new MutationObserver(renderWeekendAgent).observe(document.body, { childList: true, subtree: true });
})();
