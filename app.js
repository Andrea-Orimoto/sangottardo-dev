console.log("APP.JS LOADED SUCCESSFULLY");

window.loadPreferiti = loadPreferiti;  // ← expose it

document.addEventListener('DOMContentLoaded', () => {
  console.log("DOM READY — CALLING INIT()");
  init();
});

// ==== CONFIG ====
const REPO = 'Andrea-Orimoto/sangottardo-dev';
const GITHUB_TOKEN = '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';
// =================================

const PAGE_SIZE = 12;
let allItems = [], displayed = 0;
window.statusData = {};
window.preferitiData = {};        // ← NEW: global favorites per user

async function init() {
  try {
    // 1. Load items first
    await loadCSVAndStatus();
    console.log("INIT: Items loaded →", allItems.length);

    // 2. THEN load preferiti (this sets window.preferitiData correctly)
    await loadPreferiti();   // ← this now fully populates preferitiData

    // DO NOT renderGrid() here — loadPreferiti() will do it!

  } catch (e) {
    console.error("INIT FAILED:", e);
    const grid = document.getElementById('grid');
    if (grid) {
      grid.innerHTML = '<p class="text-red-600 col-span-full">Failed to load items: Check console (F12)</p>';
    }
    return;
  }

  if (allItems.length === 0) {
    console.warn("NO ITEMS — CHECK CSV");
    document.getElementById('grid').innerHTML = '<p class="text-center text-gray-500">No items found. Check data/items.csv</p>';
    return;
  }

  // Grid is rendered inside loadPreferiti() → correct data guaranteed
  console.log('INIT: Grid rendered');
  setupFilters();
  document.getElementById('loadMore').onclick = () => renderGrid(true);
  document.getElementById('clearFilters').onclick = clearFilters;

  // Sidebar toggle
  document.getElementById('preferitiToggle')?.addEventListener('click', () => {
    document.getElementById('preferitiSidebar').classList.toggle('-translate-x-full');
    document.getElementById('preferitiOverlay')?.classList.toggle('hidden');
  });
  document.getElementById('closePreferiti')?.addEventListener('click', () => {
    document.getElementById('preferitiSidebar').classList.add('-translate-x-full');
    document.getElementById('preferitiOverlay')?.classList.add('hidden');
  });
}

async function loadCSVAndStatus() {
  try {
    const resp = await fetch('data/items.csv');
    const text = await resp.text();
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });

    const map = new Map();
    parsed.data.forEach(row => {
      const uuid = row.UUID;
      if (!uuid) return;
      if (!map.has(uuid)) map.set(uuid, { ...row, Photos: [] });
      const photos = (row.Photos || '').trim().split(/\s+/).filter(Boolean);
      if (photos.length) map.get(uuid).Photos.push(...photos);
    });

    allItems = Array.from(map.values());

    // Load status.json
    try {
      const statusResp = await fetch('data/status.json');
      if (statusResp.ok) {
        const statusData = await statusResp.json();
        allItems.forEach(item => {
          item.Status = statusData[item.UUID] || '';
        });
      }
    } catch (e) { console.warn("No status.json — all Disponibile"); }

  } catch (e) {
    console.error("Load failed:", e);
    allItems = [];
  }
}

// ============ PREFERITI SYSTEM ============
async function loadPreferiti() {
  try {
    // USA IL RAW GITHUB URL DIRETTO — bypassa CORS e cache per sempre
    const resp = await fetch('https://raw.githubusercontent.com/Andrea-Orimoto/sangottardo-dev/main/data/preferiti.json?t=' + Date.now());

    if (resp.ok) {
      const serverData = await resp.json();
      window.preferitiData = { ...serverData };
      console.log("Preferiti caricati da raw.githubusercontent.com:", window.preferitiData);
    } else {
      window.preferitiData = {};
    }
  } catch (e) {
    console.warn("Errore caricamento preferiti — uso cache locale", e);
    window.preferitiData = {};
  }

  // SEMPRE renderizza dopo il caricamento
  renderGrid();
  renderPreferitiSidebar();
  updatePreferitiCount();
}

async function handleHeartClick(uuid) {
  if (!window.currentUser) {
    // Anon user → ask to login, then toggle automatically
    localStorage.setItem('pendingFavorite', uuid); // remember what they wanted
    google.accounts.id.prompt(); // show One-Tap / sign-in
    return;
  }
  await toggleFavorite(uuid);
}

function isFavorite(uuid) {
  // console.log('isFavorite called for UUID:', uuid, 'user:', window.currentUser?.email, 'list length:', (window.preferitiData[window.currentUser?.email] || []).length);

  if (!window.currentUser) return false;
  const list = window.preferitiData[window.currentUser.email] || [];
  return list.includes(uuid);
}

// ============ FINAL PREFERITI SYSTEM — NO MORE CONFLICTS ============
let isSavingPreferiti = false;
let saveQueue = [];

async function toggleFavorite(uuid) {
  if (!window.currentUser) {
    alert("Devi effettuare il login per salvare i Preferiti");
    return;
  }

  const email = window.currentUser.email;
  if (!window.preferitiData[email]) window.preferitiData[email] = [];

  const wasFavorite = window.preferitiData[email].includes(uuid);
  if (wasFavorite) {
    window.preferitiData[email] = window.preferitiData[email].filter(id => id !== uuid);
  } else {
    window.preferitiData[email].push(uuid);
  }

  // Optimistic UI — instant feedback
  renderGrid();
  renderPreferitiSidebar();
  updatePreferitiCount();

  // Queue the save — only one at a time
  saveQueue.push({ uuid, wasFavorite });
  if (isSavingPreferiti) return;  // already saving

  isSavingPreferiti = true;

  while (saveQueue.length > 0) {
    const { uuid: currentUuid } = saveQueue[0];

    try {
      // Always get the VERY latest SHA
      const sha = await getFileSha('data/preferiti.json');
      const content = btoa(JSON.stringify(window.preferitiData, null, 2));

      console.log('Saving preferitiData:', window.preferitiData);
      console.log('Content to send:', content);  // base64, but log the JSON first

      const response = await fetch(`https://api.github.com/repos/${REPO}/contents/data/preferiti.json`, {
        method: 'PUT',
        headers: {
          'Authorization': `token ${GITHUB_TOKEN}`,
          'Content-Type': 'application/json',
          'Accept': 'application/vnd.github.v3+json',
          'X-GitHub-Api-Version': '2022-11-28'
        },
        body: JSON.stringify({
          message: `Preferiti: ${email} ${wasFavorite ? 'rimosso' : 'aggiunto'} ${uuid}`,
          content,
          ...(sha && { sha })  // ← THIS: Only include 'sha' if it's a string (not null)
        })
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`GitHub ${response.status}: ${err}`);
      }

      // Success — remove from queue
      saveQueue.shift();
      console.log("Preferiti salvati con successo");

    } catch (e) {
      console.error("Save failed (will retry on next action):", e);
      alert("Problema di sincronizzazione — i preferiti sono salvati localmente. Continua a usare il sito, si sincronizzeranno automaticamente.");
      // Do NOT revert — keep optimistic state
      break;  // stop trying, wait for next click
    }
  }

  isSavingPreferiti = false;
}

function updatePreferitiCount() {
  const count = window.currentUser ? (window.preferitiData[window.currentUser.email] || []).length : 0;
  const el = document.getElementById('preferitiCount');
  if (el) el.textContent = count;
}

function renderPreferitiSidebar() {
  const container = document.getElementById('preferitiList');
  if (!container) return;

  const email = window.currentUser?.email;
  const uuids = email ? (window.preferitiData[email] || []) : [];

  if (uuids.length === 0) {
    container.innerHTML = '<p class="text-gray-500 text-center py-8">Nessun preferito</p>';
    document.getElementById('preferitiCount').textContent = '0';
    return;
  }

  document.getElementById('preferitiCount').textContent = uuids.length;

  const fragment = document.createDocumentFragment();
  uuids.forEach(uuid => {
    const item = allItems.find(i => i.UUID === uuid);
    if (!item) return;

    const div = document.createElement('div');
    div.className = 'flex items-center gap-3 p-3 hover:bg-gray-50 cursor-pointer border-b';
    div.onclick = () => {
      openModal(item);
      document.getElementById('preferitiSidebar').classList.add('-translate-x-full');
    };

    div.innerHTML = `
      <img src="images/${item.Photos[0] || 'placeholder.jpg'}" class="w-12 h-12 object-cover rounded" onerror="this.src='images/placeholder.jpg'">
      <span class="flex-1 text-sm font-medium truncate">${item.Item}</span>
      <button class="text-red-500 hover:text-red-700 text-xl" onclick="event.stopPropagation(); toggleFavorite('${uuid}');">
        ×
      </button>
    `;
    fragment.appendChild(div);
  });

  container.innerHTML = '';
  container.appendChild(fragment);
}
// ==========================================

function formatPrice(item) {
  const price = item['Purchase Price'];
  const currency = item['Purchase Currency'] || 'EUR';
  return price ? `${price} ${currency}` : '—';
}

function filterItems() {
  const q = (document.getElementById('search').value || '').toLowerCase().trim();
  const locFilter = document.getElementById('catFilter').value;
  const statusFilter = document.getElementById('statusFilter')?.value || '';

  return allItems.filter(item => {
    const searchText = [item.Item, item.Location, item.Categories, item.Notes].join(' ').toLowerCase();
    const matchSearch = !q || searchText.includes(q);
    const matchLocation = !locFilter || (item.Location || '') === locFilter;

    const isSold = (item.Status || '').trim() === 'Venduto';
    const matchStatus = !statusFilter ||
      (statusFilter === 'Disponibile' && !isSold) ||
      (statusFilter === 'Venduto' && isSold);

    return matchSearch && matchLocation && matchStatus;
  });
}

function setupFilters() {
  // ... your existing code unchanged ...
  // (category filter, status filter, search, etc.)
  const sel = document.getElementById('catFilter');
  const totalItems = allItems.length;

  sel.innerHTML = '';
  const allOption = document.createElement('option');
  allOption.value = '';
  allOption.textContent = `All Categories (${totalItems})`;
  sel.appendChild(allOption);

  const locations = [...new Set(allItems.map(i => i.Location).filter(Boolean))].sort();
  const locationCount = {};
  allItems.forEach(item => {
    const loc = item.Location || 'Uncategorized';
    locationCount[loc] = (locationCount[loc] || 0) + 1;
  });

  locations.forEach(loc => {
    const opt = document.createElement('option');
    opt.value = loc;
    opt.textContent = `${loc} (${locationCount[loc]})`;
    sel.appendChild(opt);
  });

  // Status filter
  const statusSel = document.createElement('select');
  statusSel.id = 'statusFilter';
  statusSel.className = 'ml-2 p-2 border rounded';
  statusSel.innerHTML = `<option value="">All Status</option><option value="Disponibile">Disponibile</option><option value="Venduto">Venduto</option>`;
  statusSel.addEventListener('change', () => { displayed = 0; renderGrid(); });
  document.querySelector('#filters').appendChild(statusSel);

  // Search + URL handling unchanged...
  let timeout;
  document.getElementById('search').addEventListener('input', () => {
    clearTimeout(timeout);
    timeout = setTimeout(() => { displayed = 0; renderGrid(); }, 300);
  });

  sel.addEventListener('change', () => {
    displayed = 0; renderGrid();
    const url = new URL(window.location);
    sel.value ? url.searchParams.set('cat', sel.value) : url.searchParams.delete('cat');
    window.history.replaceState({}, '', url);
  });

  const urlParams = new URLSearchParams(window.location.search);
  const urlCat = urlParams.get('cat');
  if (urlCat) {
    setTimeout(() => {
      const option = sel.querySelector(`option[value="${urlCat}"]`);
      if (option) { sel.value = urlCat; sel.dispatchEvent(new Event('change')); }
    }, 100);
  }
}

function clearFilters() {
  document.getElementById('search').value = '';
  document.getElementById('catFilter').value = '';
  if (document.getElementById('statusFilter')) document.getElementById('statusFilter').value = '';
  displayed = 0;
  renderGrid();
}

function renderGrid(loadMore = false) {
  if (!loadMore) {
    document.getElementById('grid').innerHTML = '';
    displayed = 0;
  }

  const container = document.getElementById('grid');
  const fragment = document.createDocumentFragment();
  const filtered = filterItems();
  const start = displayed;
  const end = Math.min(start + PAGE_SIZE, filtered.length);

  for (let i = start; i < end; i++) {
    const item = filtered[i];
    const div = document.createElement('div');
    div.className = 'bg-white rounded overflow-hidden shadow cursor-pointer hover:shadow-lg transition-shadow relative';

    const isSold = (item.Status || '').trim() === 'Venduto';
    const favorite = isFavorite(item.UUID);

    const photoCountBadge = item.Photos.length > 1 ? `
      <div class="absolute bottom-2 right-2 bg-black bg-opacity-70 text-white text-xs px-2 py-1 rounded-full flex items-center gap-1">
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
        <span>${item.Photos.length}</span>
      </div>` : '';

    const heartIcon = `
      <button onclick="event.stopPropagation(); handleHeartClick('${item.UUID}')" class="absolute top-2 right-2 bg-white/80 hover:bg-white rounded-full p-2 shadow-md transition z-10">
        <svg class="w-5 h-5 ${isFavorite(item.UUID) ? 'fill-red-500 text-red-500' : 'text-gray-400'}"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
        </svg>
      </button>`;

    const statusHtml = isSold
      ? '<span class="bg-red-100 text-red-800 text-xs px-2 py-1 rounded">Venduto</span>'
      : '<span class="bg-green-100 text-green-800 text-xs px-2 py-1 rounded">Disponibile</span>';

    div.innerHTML = `
      <div class="bg-gray-100 flex items-center justify-center rounded-t-lg h-48 relative overflow-hidden">
        <img src="images/${item.Photos[0]}" alt="${item.Item}" class="max-h-full max-w-full object-contain transition-transform hover:scale-105" onerror="this.src='images/placeholder.jpg'">
        ${photoCountBadge}
        ${heartIcon}
      </div>
      <div class="p-3 h-32 flex flex-col justify-between bg-white">
        <div>
          <h3 class="font-semibold text-sm line-clamp-2 leading-tight">${item.Item}</h3>
          <p class="text-xs text-gray-600 mt-1">Category: ${item.Location || '—'}</p>
          <p class="text-xs text-gray-500">Serial: ${item['Serial No'] || '—'}</p>
        </div>
        <div class="flex justify-between items-center">
          <p class="text-sm font-medium text-indigo-600">Price: ${formatPrice(item)}</p>
          <div class="mt-1">${statusHtml}</div>
        </div>
      </div>
    `;

    div.onclick = (e) => {
      if (!e.target.closest('button')) openModal(item);
    };
    fragment.appendChild(div);
  }

  container.appendChild(fragment);
  displayed = end;
  document.getElementById('loadMore').classList.toggle('hidden', displayed >= filtered.length);

  renderPreferitiSidebar();   // ← keep sidebar in sync
  // Update header count
  const count = window.currentUser ? (window.preferitiData[window.currentUser.email] || []).length : 0;
  document.getElementById('preferitiCount').textContent = count;
}

// ====== openModal() with heart ======
function openModal(item) {
  document.getElementById('modalTitle').textContent = item.Item;
  document.getElementById('modalDesc').innerHTML = `
    <strong>Serial Number:</strong> ${item['Serial No'] || '—'}<br>
    <strong>Category:</strong> ${item.Location || '—'}<br>
    <strong>Scatola:</strong> ${item.Categories || '—'}<br>
    ${item.Notes ? `<strong>Notes:</strong><br><span class="text-sm italic text-gray-700">${item.Notes.replace(/\n/g, '<br>')}</span><br>` : ''}
    ${item['Purchase Date'] ? `<strong>Purchased:</strong> ${item['Purchase Date']}<br>` : ''}
    <strong>Price:</strong> ${formatPrice(item)}
  `;

  const wrapper = document.getElementById('swiperWrapper');
  wrapper.innerHTML = '';
  item.Photos.forEach((src, idx) => {
    const slide = document.createElement('div');
    slide.className = 'swiper-slide flex items-center justify-center bg-gray-100';
    slide.innerHTML = `<img src="images/${src}" alt="${item.Item} - ${idx + 1}" class="max-w-full max-h-full object-contain" onerror="this.src='images/placeholder.jpg'">`;
    wrapper.appendChild(slide);
  });

  // Add heart in modal top-right
  const favorite = isFavorite(item.UUID);
  const modalHeart = `
    <button onclick="event.stopPropagation(); handleHeartClick('${item.UUID}')" class="absolute top-4 right-12 bg-white/90 hover:bg-white rounded-full p-3 shadow-lg z-10">
      <svg class="w-7 h-7 ${isFavorite(item.UUID) ? 'fill-red-500 text-red-500' : 'text-gray-500'}"
          viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
      </svg>
    </button>`;
  document.querySelector('.swiper').insertAdjacentHTML('afterbegin', modalHeart);

  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('closeModal').onclick = closeModal;

  new Swiper('.mySwiper', {
    loop: false,
    pagination: { el: '.swiper-pagination', clickable: true },
    navigation: { nextEl: '.swiper-button-next', prevEl: '.swiper-button-prev' },
    spaceBetween: 0,
    slidesPerView: 1,
    touchRatio: 1,
    grabCursor: true
  });
}

function closeModal() {
  document.getElementById('modal').classList.add('hidden');
  // Clean heart from modal
  document.querySelector('.swiper button')?.remove();
}

async function getFileSha(path) {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/contents/data/preferiti.json`, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
      }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.sha;
  } catch (e) {
    return null;
  }
}