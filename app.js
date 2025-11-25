console.log("APP.JS LOADED SUCCESSFULLY");

document.addEventListener('DOMContentLoaded', () => {
  console.log("DOM READY — CALLING INIT()");
  init();
});

// ==== CONFIG ==== 
const REPO = 'Andrea-Orimoto/sangottardo-dev';
const GITHUB_TOKEN = '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';
const ADMIN_PASSWORD_HASH = '6972cf16a98ceb52957e425cdf7dc642eca2e97cc1aef848f530509894362d32'; // default "password"
// =================================

const PAGE_SIZE = 12;
let allItems = [], displayed = 0;
window.statusData = {}; // ADD THIS LINE

// Use global googleUser from index.html

async function init() {

  // TEMP: FORCE ADMIN (REMOVE LATER)
  localStorage.setItem('adminToken', 'debug-admin');

  console.log('INIT: Starting...');
  try {
    await loadCSVAndStatus();
    console.log("INIT: Items loaded →", allItems.length);
  } catch (e) {
    console.error("INIT FAILED:", e);
    const grid = document.getElementById('grid');
    if (grid) {
      grid.innerHTML = '<p class="text-red-600 col-span-full">Failed to load items: Check console (F12)</p>';
    }
    return;
  }
  await loadAdmins();
  if (allItems.length === 0) {
    console.warn("NO ITEMS — CHECK CSV");
    document.getElementById('grid').innerHTML = '<p class="text-center text-gray-500">No items found. Check data/items.csv</p>';
    return;
  }
  renderGrid();
  console.log('INIT: Grid rendered');
  setupFilters();
  document.getElementById('loadMore').onclick = () => renderGrid(true);
  document.getElementById('clearFilters').onclick = clearFilters;
  const adminLink = document.getElementById('adminLink');
  if (adminLink && localStorage.getItem('adminToken')) {
    adminLink.classList.remove('hidden');
  }

  async function loadCSVAndStatus() {
    try {
      // Load items.csv
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

      // Load status.json (only Venduto items)
      try {
        const statusResp = await fetch('data/status.json');
        if (statusResp.ok) {
          const statusData = await statusResp.json();
          allItems.forEach(item => {
            item.Status = statusData[item.UUID] || ''; // blank = Disponibile
          });
        }
      } catch (e) {
        console.warn("No status.json — all items Disponibile");
      }

    } catch (e) {
      console.error("Load failed:", e);
      allItems = [];
    }
  }

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
    const sel = document.getElementById('catFilter');
    const totalItems = allItems.length;

    // === ONE "All Categories" ONLY ===
    sel.innerHTML = '';
    const allOption = document.createElement('option');
    allOption.value = '';
    allOption.textContent = `All Categories (${totalItems})`;
    sel.appendChild(allOption);

    // === Real categories ===
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

    // === STATUS FILTER (TOP BAR) ===
    const statusSel = document.createElement('select');
    statusSel.id = 'statusFilter';
    statusSel.className = 'ml-2 p-2 border rounded';
    statusSel.innerHTML = `
      <option value="">All Status</option>
      <option value="Disponibile">Disponibile</option>
      <option value="Venduto">Venduto</option>
    `;
    statusSel.addEventListener('change', () => { displayed = 0; renderGrid(); });
    document.querySelector('#filters').appendChild(statusSel);

    const filtersDiv = document.querySelector('#filters');
    if (filtersDiv) filtersDiv.appendChild(statusSel);

    // === Search ===
    let timeout;
    document.getElementById('search').addEventListener('input', () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => { displayed = 0; renderGrid(); }, 300);
    });

    // === Category change + URL update ===
    sel.addEventListener('change', () => {
      displayed = 0;
      renderGrid();
      const url = new URL(window.location);
      const val = sel.value;
      if (val) {
        url.searchParams.set('cat', val);
      } else {
        url.searchParams.delete('cat');
      }
      window.history.replaceState({}, '', url);
    });

    // === Status change ===
    statusSel.addEventListener('change', () => { displayed = 0; renderGrid(); saveStatus(); });

    // === URL ?cat= pre-select ===
    const urlParams = new URLSearchParams(window.location.search);
    const urlCat = urlParams.get('cat');
    if (urlCat) {
      setTimeout(() => {
        const option = sel.querySelector(`option[value="${urlCat}"]`);
        if (option) {
          sel.value = urlCat;
          sel.dispatchEvent(new Event('change'));
        }
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
      div.className = 'bg-white rounded overflow-hidden shadow cursor-pointer hover:shadow-lg transition-shadow';

      // === STATUS BADGE & DROPDOWN (VISIBLE TO ALL) ===
      // === STATUS BADGE (NON-ADMIN) OR DROPDOWN (ADMIN) ===
      const isSold = (item.Status || '').trim() === 'Venduto';
      const isAdmin = !!localStorage.getItem('adminToken');

      let statusHtml;
      if (false) {
        statusHtml = `
        <select class="text-xs p-1 rounded border bg-white" 
                onchange="saveStatus('${item.UUID}', this.value)"
                onclick="event.stopPropagation();">
          <option value="Disponibile" ${!isSold ? 'selected' : ''}>Disponibile</option>
          <option value="Venduto" ${isSold ? 'selected' : ''}>Venduto</option>
        </select>
      `;
      } else {
        statusHtml = isSold
          ? '<span class="bg-red-100 text-red-800 text-xs px-2 py-1 rounded">Venduto</span>'
          : '<span class="bg-green-100 text-green-800 text-xs px-2 py-1 rounded">Disponibile</span>';
      }

      // === PHOTO COUNT BADGE ===
      const photoCountBadge = item.Photos.length > 1 ? `
      <div class="absolute bottom-2 right-2 bg-black bg-opacity-70 text-white text-xs px-2 py-1 rounded-full flex items-center gap-1">
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
        </svg>
        <span>${item.Photos.length}</span>
      </div>
    ` : '';

      // === CARD HTML ===
      div.innerHTML = `
      <div class="bg-gray-100 flex items-center justify-center rounded-t-lg h-48 relative overflow-hidden">
        <img src="images/${item.Photos[0]}" alt="${item.Item}" 
            class="max-h-full max-w-full object-contain transition-transform hover:scale-105" 
            onerror="this.src='images/placeholder.jpg'">
        ${photoCountBadge}
       
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

      div.onclick = () => openModal(item);
      fragment.appendChild(div);
    }

    container.appendChild(fragment);
    displayed = end;
    document.getElementById('loadMore').classList.toggle('hidden', displayed >= filtered.length);
  }

  // ====== openModal() ======
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
  }

  // Google Login

  function signOut() {
    gapi.auth2.getAuthInstance().signOut().then(() => {
      googleUser = null;
      document.getElementById('userInfo').classList.add('hidden');
      document.getElementById('googleSignIn').classList.remove('hidden');
    });
  }

  async function saveStatus(uuid, value) {
    if (!localStorage.getItem('adminToken')) {
      alert('Only admins can change status');
      renderGrid();
      return;
    }

    const saveValue = value === 'Disponibile' ? '' : 'Venduto';

    try {
      const resp = await fetch('data/status.json');
      const current = resp.ok ? await resp.json() : {};

      if (saveValue === '') {
        delete current[uuid]; // Remove from status.json if Disponibile
      } else {
        current[uuid] = saveValue;
      }

      const content = btoa(JSON.stringify(current, null, 2));
      const sha = await getFileSha('data/status.json');

      await fetch(`https://api.github.com/repos/${REPO}/contents/data/status.json`, {
        method: 'PUT',
        headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `Status: ${uuid} → ${value}`, content, sha })
      });

      const item = allItems.find(i => i.UUID === uuid);
      if (item) item.Status = saveValue;

      renderGrid();
      console.log(`SAVED: ${uuid} → ${value}`);
    } catch (e) {
      alert('Save failed');
    }
  }

  async function getFileSha(path) {
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`);
      const data = await res.json();
      return data.sha;
    } catch (e) { return null; }
  }
}

let admins = [];

async function loadAdmins() {
  try {
    const resp = await fetch('data/admins.json');
    if (resp.ok) {
      admins = await resp.json();
      console.log("Admins loaded:", admins);
      checkAdminAccess();
    }
  } catch (e) {
    console.error("Failed to load admins.json", e);
  }
}

function checkAdminAccess() {
  if (!googleUser) return;
  const profile = googleUser.getBasicProfile();
  const email = profile.getEmail();
  const adminLink = document.getElementById('adminLink');
  if (admins.includes(email) && adminLink) {
    adminLink.classList.remove('hidden');
    console.log("ADMIN ACCESS GRANTED:", email);
  }
}

async function saveStatus(uuid, newStatus) {
  const saveValue = newStatus === 'Attivo' ? '' : newStatus;
  try {
    const resp = await fetch('data/status.json');
    const data = resp.ok ? await resp.json() : {};
    data[uuid] = saveValue;

    await fetch(`https://api.github.com/repos/${REPO}/contents/data/status.json`, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: `Status: ${uuid} → ${newStatus}`,
        content: btoa(JSON.stringify(data, null, 2)),
        sha: await getFileSha('data/status.json')
      })
    });

    // Update item in memory
    const item = allItems.find(i => i.UUID === uuid);
    if (item) item.Status = saveValue;

    renderGrid(); // Refresh grid
  } catch (e) {
    alert('Failed to save status: ' + e.message);
  }
}

function filterByStatus(value) {
  const statusFilter = document.getElementById('statusFilter');
  if (statusFilter) statusFilter.value = value;
  displayed = 0;
  renderGrid();
}