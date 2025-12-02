console.log("APP.JS LOADED SUCCESSFULLY");

window.loadPreferiti = loadPreferiti;  // ← expose it

// Trasforma email in chiave valida per Firebase (sostituisce . con _)
function getEmailKey(email) {
  return email.replace(/\./g, '_');
}

document.addEventListener('DOMContentLoaded', () => {
  console.log("DOM READY — CALLING INIT()");
  init();
});

const PAGE_SIZE = 12;
let allItems = [], displayed = 0;
window.statusData = {};
window.preferitiData = {};        // ← NEW: global favorites per user

async function init() {
  try {
    await loadCSVAndStatus();
    console.log("INIT: Items loaded →", allItems.length);

    await loadPreferiti();

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

  console.log('INIT: Grid rendered');
  setupFilters();
  document.getElementById('loadMore').onclick = () => renderGrid(true);

  document.getElementById('preferitiToggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const sidebar = document.getElementById('preferitiSidebar');
    const overlay = document.getElementById('preferitiOverlay');
    sidebar.classList.toggle('-translate-x-full');
    overlay.classList.toggle('hidden');
  }, { passive: false });

  document.getElementById('closePreferiti')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const sidebar = document.getElementById('preferitiSidebar');
    const overlay = document.getElementById('preferitiOverlay');
    sidebar.classList.add('-translate-x-full');
    overlay.classList.add('hidden');
  }, { passive: false });

  document.getElementById('preferitiOverlay')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const sidebar = document.getElementById('preferitiSidebar');
    sidebar.classList.add('-translate-x-full');
    e.target.classList.add('hidden');
  }, { passive: false });
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

    // CARICA STATUS DA FIREBASE + ESPONE DATI
    try {
      const snapshot = await db.ref('status').once('value');
      const statusData = snapshot.val() || {};

      window.allStatus = statusData;

      allItems.forEach(item => {
        const fbEntry = statusData[item.UUID];
        if (fbEntry && fbEntry.stato) {
          item.Status = fbEntry.stato;
        } else {
          item.Status = '';
        }
      });
      console.log('Status caricati da Firebase:', Object.keys(statusData).length);
    } catch (e) {
      console.warn('Impossibile caricare status da Firebase (normale se offline)', e);
    }

  } catch (e) {
    console.error("Caricamento fallito:", e);
    allItems = [];
  }
}

// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyCq_W69Eab67KpnX8HTEkzRHBW7TB_6daQ",
  authDomain: "san-gottardo-preferiti.firebaseapp.com",
  databaseURL: "https://san-gottardo-preferiti-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "san-gottardo-preferiti",
  storageBucket: "san-gottardo-preferiti.firebasestorage.app",
  messagingSenderId: "1012486211234",
  appId: "1:1012486211234:web:04b3bb02b84cb19ef839fb",
  measurementId: "G-LSLDZBSJFR"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth();

// Carica preferiti da Firebase
async function loadPreferiti() {
  if (!window.currentUser) {
    window.preferitiData = {};
    renderGrid();
    renderPreferitiSidebar();
    updatePreferitiCount();
    return;
  }

  const key = window.currentUser.email.replace(/\./g, '_');
  try {
    const snapshot = await db.ref('preferiti/' + key).once('value');
    const data = snapshot.val();
    window.preferitiData[window.currentUser.email] = data || [];
    console.log("Preferiti caricati da Firebase:", window.preferitiData[window.currentUser.email]);
  } catch (e) {
    console.warn("Firebase non raggiungibile — uso lista vuota", e);
    window.preferitiData[window.currentUser.email] = [];
  }

  renderGrid();
  renderPreferitiSidebar();
  updatePreferitiCount();
}

// toggleFavorite
async function toggleFavorite(uuid) {
  if (!window.currentUser) {
    alert("Devi effettuare il login per salvare i Preferiti");
    return;
  }

  const email = window.currentUser.email;
  const key = email.replace(/\./g, '_');
  let list = (window.preferitiData[email] || []).slice();

  const index = list.findIndex(entry =>
    (typeof entry === 'string' ? entry : entry.id) === uuid
  );

  const wasFavorite = index > -1;
  const isNowFavorite = !wasFavorite;

  if (wasFavorite) {
    list.splice(index, 1);
  } else {
    list.push({
      id: uuid,
      added: new Date().toISOString()
    });
  }

  window.preferitiData[email] = list;

  updateHeartIcon(uuid, isNowFavorite);
  updatePreferitiCount();
  renderPreferitiSidebar();

  db.ref('preferiti/' + key).set(list.length > 0 ? list : null)
    .then(() => console.log("Preferiti salvati su Firebase"))
    .catch(e => console.warn("Errore salvataggio Firebase:", e));
}

function updateHeartIcon(uuid, isAdded) {
  const card = document.querySelector(`[data-uuid="${uuid}"]`);
  if (!card) return;

  const svg = card.querySelector('.heart-btn svg');
  if (!svg) return;

  if (isAdded) {
    svg.classList.remove('text-gray-500');
    svg.classList.add('text-red-500', 'fill-red-500');
  } else {
    svg.classList.remove('text-red-500', 'fill-red-500');
    svg.classList.add('text-gray-500');
  }

  card.classList.add('scale-105', 'transition-transform');
  setTimeout(() => card.classList.remove('scale-105'), 200);
}

function updatePreferitiCount() {
  const countEl = document.getElementById('preferitiCount');
  if (countEl && window.currentUser) {
    const count = (window.preferitiData[window.currentUser.email] || []).length;
    countEl.textContent = count;
  }
}

function isFavorite(uuid) {
  if (!window.currentUser?.email) return false;
  const list = window.preferitiData[window.currentUser.email] || [];
  return list.some(entry =>
    typeof entry === 'string' ? entry === uuid : entry.id === uuid
  );
}

window.handleHeartClick = async function (uuid) {
  if (!window.currentUser) {
    alert("Devi effettuare il login per salvare i Preferiti");
    return;
  }

  await toggleFavorite(uuid);

  const modalHeartBtn = document.querySelector('.swiper button[data-heart]');
  if (modalHeartBtn) {
    const isNowFavorite = isFavorite(uuid);
    modalHeartBtn.querySelector('svg').className =
      `w-7 h-7 ${isNowFavorite ? 'fill-red-500 text-red-500' : 'text-gray-500'}`;
  }
};

function renderPreferitiSidebar() {
  const container = document.getElementById('preferitiList');
  if (!container) return;

  const email = window.currentUser?.email;
  let list = email ? (window.preferitiData[email] || []) : [];

  list = list.map(entry =>
    typeof entry === 'string' ? { id: entry, added: new Date().toISOString() } : entry
  );

  if (list.length === 0) {
    container.innerHTML = '<p class="text-gray-500 text-center py-8">Nessun preferito</p>';
    document.getElementById('preferitiCount').textContent = '0';
    return;
  }

  list.sort((a, b) => new Date(b.added) - new Date(a.added));

  document.getElementById('preferitiCount').textContent = list.length;

  const fragment = document.createDocumentFragment();
  list.forEach(entry => {
    const item = allItems.find(i => i.UUID === entry.id);
    if (!item) return;

    const div = document.createElement('div');
    div.className = 'flex items-center gap-3 p-3 hover:bg-gray-50 cursor-pointer border-b';
    div.onclick = () => {
      openModal(item);
      document.getElementById('preferitiSidebar').classList.add('-translate-x-full');
    };

    const dateStr = new Date(entry.added).toLocaleDateString('it-IT', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
    });

    div.innerHTML = `
      <img src="images/${item.Photos[0] || 'placeholder.jpg'}" class="w-12 h-12 object-cover rounded" onerror="this.src='images/placeholder.jpg'">
      <div class="flex-1">
        <span class="text-sm font-medium truncate block">${item.Item}</span>
        <span class="text-xs text-gray-500">Aggiunto il ${dateStr}</span>
      </div>
      <button class="text-red-500 hover:text-red-700 text-xl" onclick="event.stopPropagation(); toggleFavorite('${entry.id}');">
        ×
      </button>
    `;
    fragment.appendChild(div);
  });

  container.innerHTML = '';
  container.appendChild(fragment);
}

// PREZZO SOLO DA FIREBASE
function formatPrice(item) {
  const statusInfo = window.allStatus?.[item.UUID] || {};
  const prezzo = statusInfo.prezzo && statusInfo.prezzo.trim() !== '' && statusInfo.prezzo !== '?'
    ? statusInfo.prezzo.trim()
    : null;

  return prezzo ? `<strong>${prezzo}</strong>` : '—';
}

function filterItems() {
  const q = (document.getElementById('search').value || '').toLowerCase().trim();
  const locFilter = document.getElementById('catFilter').value;
  const statusFilter = document.getElementById('statusFilter')?.value || '';

  return allItems.filter(item => {
    const searchText = [item.Item, item.Location, item.Categories, item.Notes, item['Serial No']].join(' ').toLowerCase();
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
  const filtersContainer = document.querySelector('#filters');

  function updateCategoryCounts() {
    const currentStatus = document.getElementById('statusFilter')?.value || '';
    const filteredItems = filterItems(); // Usa il filtro status corrente

    sel.innerHTML = '';
    const allOption = document.createElement('option');
    allOption.value = '';
    allOption.textContent = `All Categories (${filteredItems.length})`;
    sel.appendChild(allOption);

    const locationCount = {};
    filteredItems.forEach(item => {
      const loc = item.Location || 'Uncategorized';
      locationCount[loc] = (locationCount[loc] || 0) + 1;
    });

    const locations = [...new Set(filteredItems.map(i => i.Location).filter(Boolean))].sort();
    locations.forEach(loc => {
      const opt = document.createElement('option');
      opt.value = loc;
      opt.textContent = `${loc} (${locationCount[loc]})`;
      sel.appendChild(opt);
    });

    // Aggiungi "Uncategorized" se esiste
    if (locationCount['Uncategorized']) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = `Uncategorized (${locationCount['Uncategorized']})`;
      sel.appendChild(opt);
    }
  }

  // Crea il dropdown Status (una volta sola)
  let statusSel = document.getElementById('statusFilter');
  if (!statusSel) {
    statusSel = document.createElement('select');
    statusSel.id = 'statusFilter';
    statusSel.className = 'ml-2 p-2 border rounded';
    statusSel.innerHTML = `<option value="">All Status</option><option value="Disponibile">Disponibile</option><option value="Venduto">Venduto</option>`;
    filtersContainer.appendChild(statusSel);
  }

  // Aggiorna i conteggi all'avvio
  updateCategoryCounts();

  // Aggiorna quando cambia Status
  statusSel.addEventListener('change', () => {
    displayed = 0;
    renderGrid();
    updateCategoryCounts();
  });

  // Aggiorna anche quando cambia ricerca
  let timeout;
  document.getElementById('search').addEventListener('input', () => {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      displayed = 0;
      renderGrid();
      updateCategoryCounts();
    }, 300);
  });

  // Aggiorna quando cambia categoria
  sel.addEventListener('change', () => {
    displayed = 0;
    renderGrid();
    const url = new URL(window.location);
    sel.value ? url.searchParams.set('cat', sel.value) : url.searchParams.delete('cat');
    window.history.replaceState({}, '', url);
  });

  // Ripristina filtro da URL
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

    div.dataset.uuid = item.UUID;

    const isSold = (item.Status || '').trim() === 'Venduto';

    const photoCountBadge = item.Photos.length > 1 ? `
      <div class="absolute bottom-2 right-2 bg-black bg-opacity-70 text-white text-xs px-2 py-1 rounded-full flex items-center gap-1">
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
        <span>${item.Photos.length}</span>
      </div>` : '';

    const heartIcon = `
  <button onclick="event.stopPropagation(); handleHeartClick('${item.UUID}')" class="heart-btn absolute top-2 right-2 bg-white/80 hover:bg-white rounded-full p-2 shadow-md transition z-10">
    <svg class="w-5 h-5 ${isFavorite(item.UUID) ? 'fill-red-500 text-red-500' : 'text-gray-500'}" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
      <path fill-rule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clip-rule="evenodd" fill="currentColor"></path>
    </svg>
  </button>`;

    const editButton = window.currentUser && window.isAdmin(window.currentUser) ? `
      <button onclick="event.stopPropagation(); openEditModal('${item.UUID}')" 
              class="absolute top-2 left-2 bg-white/90 hover:bg-white rounded-full p-2 shadow-md transition z-10">
        <svg class="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
        </svg>
      </button>` : '';

    const statusHtml = isSold
      ? '<span class="bg-red-100 text-red-800 text-xs px-2 py-1 rounded">Venduto</span>'
      : '<span class="bg-green-100 text-green-800 text-xs px-2 py-1 rounded">Disponibile</span>';

    div.innerHTML = `
      <div class="bg-gray-100 flex items-center justify-center rounded-t-lg h-48 relative overflow-hidden">
        <img src="images/${item.Photos[0]}" alt="${item.Item}" class="max-h-full max-w-full object-contain transition-transform hover:scale-105" onerror="this.src='images/placeholder.jpg'">
        ${photoCountBadge}
        ${heartIcon}
        ${editButton}
      </div>
      <div class="p-3 h-32 flex flex-col justify-between bg-white">
        <div>
          <h3 class="font-semibold text-sm line-clamp-2 leading-tight">${item.Item}</h3>
          <p class="text-xs text-gray-600 mt-1">Category: ${item.Location || '—'}</p>
          <p class="text-xs text-gray-500">ID: ${item['Serial No'] || '—'}</p>
        </div>
        <div class="flex justify-between items-center">
          <p class="text-sm font-medium text-indigo-600">Prezzo: ${formatPrice(item)}</p>
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

  renderPreferitiSidebar();
  const count = window.currentUser ? (window.preferitiData[window.currentUser.email] || []).length : 0;
  document.getElementById('preferitiCount').textContent = count;
}

let currentSwiper = null;

function openModal(item) {
  document.getElementById('modalTitle').textContent = item.Item;
  document.getElementById('modalDesc').innerHTML = `
    <strong>ID:</strong> ${item['Serial No'] || '—'}<br>
    <strong>Category:</strong> ${item.Location || '—'}<br>
    <strong>Scatola:</strong> ${item.Categories || '—'}<br>
    ${item.Notes ? `<strong>Notes:</strong><br><span class="text-sm italic text-gray-700">${item.Notes.replace(/\n/g, '<br>')}</span><br>` : ''}
    ${item['Purchase Date'] ? `<strong>Purchased:</strong> ${item['Purchase Date']}<br>` : ''}
    <strong>Prezzo:</strong> ${formatPrice(item)}
  `;

  const wrapper = document.getElementById('swiperWrapper');
  wrapper.innerHTML = '';
  item.Photos.forEach((src, idx) => {
    const slide = document.createElement('div');
    slide.className = 'swiper-slide flex items-center justify-center bg-gray-100';
    slide.innerHTML = `<img src="images/${src}" alt="${item.Item} - ${idx + 1}" class="max-w-full max-h-full object-contain" onerror="this.src='images/placeholder.jpg'">`;
    wrapper.appendChild(slide);
  });

  // Rimuovi vecchio cuore
  document.querySelector('.swiper button[data-heart]')?.remove();

  // Distruggi vecchio Swiper
  if (currentSwiper) {
    currentSwiper.destroy(true, true);
    currentSwiper = null;
  }

  // FORZA L'ALTEZZA DEL CONTAINER (QUESTA È LA CHIAVE)
  const swiperContainer = document.querySelector('.mySwiper');
  swiperContainer.style.height = '60vh';
  swiperContainer.style.maxHeight = '500px';

  // Nuovo Swiper
  currentSwiper = new Swiper('.mySwiper', {
    loop: false,
    pagination: { el: '.swiper-pagination', clickable: true },
    navigation: { nextEl: '.swiper-button-next', prevEl: '.swiper-button-prev' },
    spaceBetween: 0,
    slidesPerView: 1,
    touchRatio: 1,
    grabCursor: true,
    initialSlide: 0
  });

  // Cuore nel modal
  const modalHeart = document.createElement('button');
  modalHeart.setAttribute('data-heart', 'true');
  modalHeart.className = 'absolute top-4 right-12 bg-white/90 hover:bg-white rounded-full p-3 shadow-lg z-10';
  modalHeart.innerHTML = `
  <svg class="w-7 h-7 ${isFavorite(item.UUID) ? 'fill-red-500 text-red-500' : 'text-gray-500'}"
       viewBox="0 0 24 24" fill="currentColor">
    <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
  </svg>
  `;

  modalHeart.onclick = async (e) => {
    e.stopPropagation();
    await handleHeartClick(item.UUID);
    const newFavorite = isFavorite(item.UUID);
    modalHeart.innerHTML = `
    <svg class="w-7 h-7 ${newFavorite ? 'fill-red-500 text-red-500' : 'text-gray-500'}"
        viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
    </svg>
  `;
  };

  document.querySelector('.swiper').insertAdjacentElement('afterbegin', modalHeart);

  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('closeModal').onclick = closeModal;
}

function closeModal() {
  document.getElementById('modal').classList.add('hidden');
  document.querySelector('.swiper button[data-heart]')?.remove();
  
  if (currentSwiper) {
    currentSwiper.destroy(true, true);
    currentSwiper = null;
  }
}