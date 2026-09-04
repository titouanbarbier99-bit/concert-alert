let artistList = [];
let allConcerts = [];
let pollingInterval = null;

(function init() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  if (token) {
    autoSearchFromSpotify(token);
  }
})();

async function autoSearchFromSpotify(token) {
  try {
    const res = await fetch(`/api/my-artists?token=${encodeURIComponent(token)}`);
    const data = await res.json();
    if (data.artists && data.artists.length > 0) {
      artistList = data.artists.map(a => a.name);
      renderTags();
      updateSearchButton();
      await searchConcerts();
    } else {
      showToast('Aucun artiste trouvé. Accède au moins à une playlist.');
      showScreen('screen-artists');
    }
  } catch (err) {
    console.error('Auto search error:', err);
    showScreen('screen-artists');
  }
}

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
    `<span class="artist-tag">${a} <button onclick="removeArtist(${i})">✕</button></span>`
  ).join('');
  document.getElementById('artist-count').textContent =
    artistList.length > 0 ? `${artistList.length} artiste${artistList.length > 1 ? 's' : ''}` : '';
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

  document.getElementById('artist-summary').textContent = `${artistList.length} artiste${artistList.length > 1 ? 's' : ''} en cours de recherche...`;

  allConcerts = [];
  const total = artistList.length;

  for (let i = 0; i < total; i++) {
    const artist = artistList[i];
    const progress = document.getElementById('progress-fill');
    progress.style.width = `${((i + 1) / total) * 100}%`;
    document.getElementById('loading-text').textContent = `Recherche : ${artist} (${i + 1}/${total})...`;

    try {
      const res = await fetch(`/api/concerts/${encodeURIComponent(artist)}`);
      const data = await res.json();
      if (data.concerts && data.concerts.length > 0) {
        allConcerts.push(...data.concerts);
      }
    } catch (err) {
      console.error(`Error searching ${artist}:`, err);
    }
  }

  document.getElementById('progress-fill').style.width = '100%';
  document.getElementById('loading-text').textContent = 'Terminé !';
  setTimeout(() => { loading.style.display = 'none'; }, 500);

  document.getElementById('artist-summary').textCon
