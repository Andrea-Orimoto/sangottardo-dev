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

  // Sidebar toggle — FIXED for mobile
  document.getElementById('preferitiToggle')?.addEventListener('click', (e) => {
    e.stopPropagation();  // ← ADD: Prevent bubbling to header
    const sidebar = document.getElementById('preferitiSidebar');
    const overlay = document.getElementById('preferitiOverlay');
    sidebar.classList.toggle('-translate-x-full');
    overlay.classList.toggle('hidden');
  }, { passive: false });  // ← ADD: For touch events on mobile

  document.getElementById('closePreferiti')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const sidebar = document.getElementById('preferitiSidebar');
    const overlay = document.getElementById('preferitiOverlay');
    sidebar.classList.add('-translate-x-full');
    overlay.classList.add('hidden');
  }, { passive: false });

  // Overlay click to close — FIXED to not block grid touches
  document.getElementById('preferitiOverlay')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const sidebar = document.getElementById('preferitiSidebar');
    sidebar.classList.add('-translate-x-full');
    e.target.classList.add('hidden');  // ← Self-hide
  }, { passive: false });
}

async function loadCSVAndStatus() {
  try {
    // 1. Carica il CSV (uguale a prima – perfetto)
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

    // 2. CARICA STATUS DA FIREBASE (nuovo!)
    try {
      const snapshot = await db.ref('status').once('value');
      const statusData = snapshot.val() || {};

      allItems.forEach(item => {
        const fbEntry = statusData[item.UUID];
        if (fbEntry && fbEntry.stato) {
          item.Status = fbEntry.stato;  // "Venduto", "Prenotato", ecc.
        } else {
          item.Status = '';  // Disponibile
        }
      });
      console.log('Status caricati da Firebase:', Object.keys(statusData).length);
    } catch (e) {
      console.warn('Impossibile caricare status da Firebase (normale se offline)', e);
      // Non blocca nulla – gli item rimangono "Disponibile"
    }

  } catch (e) {
    console.error("Caricamento fallito:", e);
    allItems = [];
  }
}

// ============ PREFERITI SYSTEM ============
// Firebase config — incolla la tua qui
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
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

// Inizializza Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth();


// Carica preferiti da Firebase
// ---- FUNZIONE 1: loadPreferiti (sostituisci tutta) ----
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

// Salva su Firebase (istantaneo!)
// 1. toggleFavorite — ora salva la data (compatibile con vecchi dati)
async function toggleFavorite(uuid) {
  if (!window.currentUser) {
    alert("Devi effettuare il login per salvare i Preferiti");
    return;
  }

  const email = window.currentUser.email;
  const key = email.replace(/\./g, '_');
  let list = (window.preferitiData[email] || []).slice();

  // Trova se esiste già (supporta sia stringa che oggetto)
  const index = list.findIndex(entry => 
    (typeof entry === 'string' ? entry : entry.id) === uuid
  );

  if (index > -1) {
    list.splice(index, 1);
  } else {
    // Aggiunge con data
    list.push({
      id: uuid,
      added: new Date().toISOString()
    });
  }

  window.preferitiData[email] = list;
  renderGrid();
  renderPreferitiSidebar();
  updatePreferitiCount?.() || (document.getElementById('preferitiCount').textContent = list.length);

  // Salva su Firebase
  db.ref('preferiti/' + key).set(list)
    .then(() => console.log("Preferiti salvati su Firebase"))
    .catch(e => console.warn("Errore salvataggio Firebase:", e));
}

// Integra con il tuo login esistente
// In auth.js, in handleCredentialResponse, dopo window.currentUser = ... :
if (window.currentUser && window.currentUser.id) {
  auth.signInWithCustomToken(window.currentUser.id).catch(() => { });
}

// Aggiorna isFavorite per usare Firebase data
function isFavorite(uuid) {
  if (!window.currentUser?.email) return false;
  const list = window.preferitiData[window.currentUser.email] || [];
  return list.some(entry => 
    typeof entry === 'string' ? entry === uuid : entry.id === uuid
  );
}

// NUOVA handleHeartClick — restituisce Promise
window.handleHeartClick = async function (uuid) {
  if (!window.currentUser) {
    alert("Devi effettuare il login per salvare i Preferiti");
    return;
  }

  await toggleFavorite(uuid);  // ← ASPETTA che finisca!

  // Ora possiamo aggiornare il cuore nel modal in modo sicuro
  const modalHeartBtn = document.querySelector('.swiper button[data-heart]');
  if (modalHeartBtn) {
    const isNowFavorite = isFavorite(uuid);
    modalHeartBtn.querySelector('svg').className =
      `w-7 h-7 ${isNowFavorite ? 'fill-red-500 text-red-500' : 'text-gray-500'}`;
  }
};

// ============ FINAL PREFERITI SYSTEM — NO MORE CONFLICTS ============
let isSavingPreferiti = false;
let saveQueue = [];



function updatePreferitiCount() {
  const count = window.currentUser ? (window.preferitiData[window.currentUser.email] || []).length : 0;
  const el = document.getElementById('preferitiCount');
  if (el) el.textContent = count;
}

// 2. renderPreferitiSidebar — identica alla tua, ma con data e ordine
function renderPreferitiSidebar() {
  const container = document.getElementById('preferitiList');
  if (!container) return;

  const email = window.currentUser?.email;
  let list = email ? (window.preferitiData[email] || []) : [];

  // Normalizza: converte vecchie stringhe in oggetti con data
  list = list.map(entry => 
    typeof entry === 'string' ? { id: entry, added: new Date().toISOString() } : entry
  );

  if (list.length === 0) {
    container.innerHTML = '<p class="text-gray-500 text-center py-8">Nessun preferito</p>';
    document.getElementById('preferitiCount').textContent = '0';
    return;
  }

  // Ordina per data (più recente sopra)
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
    <svg class="w-5 h-5 ${isFavorite(item.UUID) ? 'fill-red-500 text-red-500' : 'text-gray-500'}" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
      <path fill-rule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clip-rule="evenodd" fill="currentColor"></path>
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
          <p class="text-xs text-gray-500">ID: ${item['Serial No'] || '—'}</p>
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
    <strong>ID:</strong> ${item['Serial No'] || '—'}<br>
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
  // Rimuovi cuore precedente
  document.querySelector('.swiper button[data-heart]')?.remove();

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
    await handleHeartClick(item.UUID);  // ← AWAIT the toggle — ensures data is updated
    const newFavorite = isFavorite(item.UUID);
    modalHeart.innerHTML = `
    <svg class="w-7 h-7 ${isFavorite(item.UUID) ? 'fill-red-500 text-red-500' : 'text-gray-500'}"
        viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
    </svg>
  `;
  };

  document.querySelector('.swiper').insertAdjacentElement('afterbegin', modalHeart);

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
