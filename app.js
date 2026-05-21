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

const PAGE_SIZE = 24;
let allItems = [], displayed = 0;
window.statusData = {};
window.allStatus = {};
window.adminStatusDetails = {};
window.itemBoxes = {};
window.boxLocations = {};
window.looseItemLocations = {};
let selectedTags = new Set();
let tagCatalog = [];
let itemTags = {};
let isTagMode = true;
let activeTagEditorId = null;
let activeTagEditorPosition = null;
let pendingTagWrites = new Set();

const FILTER_STORAGE_KEY = 'sanGottardoFilters';

function isCurrentAdmin() {
  return !!(window.currentUser && window.isAdmin?.(window.currentUser));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function normalizeTag(value) {
  return String(value || '').trim().replace(/^#/, '').replace(/[\s.#$\/\[\]]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

function normalizeTags(tags) {
  return [...new Set((Array.isArray(tags) ? tags : []).map(normalizeTag).filter(Boolean))].sort();
}

function displayTag(tag) {
  return String(tag || '').replace(/-/g, ' ');
}

function categoryTag(item) {
  return normalizeTag(item.Location || '');
}

function loadFilterState() {
  try {
    const saved = JSON.parse(localStorage.getItem(FILTER_STORAGE_KEY) || '{}');
    selectedTags = new Set(normalizeTags(saved.tags || []).slice(0, 1));
  } catch {
    selectedTags = new Set();
  }
}

function saveFilterState() {
  localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify({ tags: [...selectedTags] }));
}

function getItemTags(item) {
  return normalizeTags(item?.Tags || []);
}

function getItemBox(item) {
  return String(window.itemBoxes?.[item?.UUID] || '').trim();
}

function getBoxLocation(box) {
  return box ? String(window.boxLocations?.[box] || '').trim() : '';
}

function getLooseItemLocation(item) {
  return String(window.looseItemLocations?.[item?.UUID] || '').trim();
}

function formatBoxWithLocation(box) {
  const location = getBoxLocation(box);
  return location ? `${box} (${location})` : box;
}

function getAdminPositionLine(item) {
  if (!isCurrentAdmin()) return '';

  const box = getItemBox(item);
  if (box) return `Scatola: ${escapeHtml(formatBoxWithLocation(box))}`;

  const location = getLooseItemLocation(item);
  if (location) return `Posizione: ${escapeHtml(location)}`;

  return '';
}

async function loadPositionData() {
  window.itemBoxes = {};
  window.boxLocations = {};
  window.looseItemLocations = {};

  if (!isCurrentAdmin()) return;

  try {
    const hasAuth = await window.waitForFirebaseAdminAuth?.(2500);
    if (!hasAuth) {
      console.warn('Posizioni non caricate: riconnetti Google/Firebase come admin.');
      return;
    }

    const [itemBoxesSnapshot, boxLocationsSnapshot, looseItemLocationsSnapshot] = await Promise.all([
      db.ref('itemBoxes').once('value'),
      db.ref('boxLocations').once('value'),
      db.ref('looseItemLocations').once('value')
    ]);

    window.itemBoxes = itemBoxesSnapshot.val() || {};
    window.boxLocations = boxLocationsSnapshot.val() || {};
    window.looseItemLocations = looseItemLocationsSnapshot.val() || {};
  } catch (err) {
    console.warn('Impossibile caricare le posizioni da Firebase', err);
  }
}

async function loadTagsForItems() {
  let firebaseTags = {};
  let firebaseCatalog = {};

  try {
    if (isCurrentAdmin()) {
      const statusSnapshot = await db.ref('status').once('value');
      const statusData = statusSnapshot.val() || {};
      firebaseCatalog = statusData.__tagCatalog || {};
      Object.entries(statusData).forEach(([uuid, entry]) => {
        if (uuid !== '__tagCatalog' && Array.isArray(entry?.tags)) {
          firebaseTags[uuid] = entry.tags;
        }
      });
    } else {
      const catalogSnapshot = await db.ref('status/__tagCatalog').once('value').catch(() => null);
      firebaseCatalog = catalogSnapshot?.val?.() || {};
      const tagEntries = await Promise.all(allItems.map(async item => {
        try {
          const snapshot = await db.ref(`status/${item.UUID}/tags`).once('value');
          return [item.UUID, snapshot.val() || []];
        } catch {
          return [item.UUID, []];
        }
      }));
      firebaseTags = Object.fromEntries(tagEntries.filter(([, tags]) => Array.isArray(tags) && tags.length));
    }
  } catch (err) {
    console.warn('Firebase tags unavailable, using category fallback', err);
  }

  itemTags = firebaseTags || {};
  allItems.forEach(item => {
    const savedTags = normalizeTags(itemTags[item.UUID] || []);
    const fallbackTags = savedTags.length ? savedTags : normalizeTags([categoryTag(item)]);
    item.Tags = fallbackTags;
  });

  tagCatalog = normalizeTags([
    ...Object.keys(firebaseCatalog || {}),
    ...Object.values(itemTags || {}).flatMap(tags => Array.isArray(tags) ? tags : []),
    ...allItems.flatMap(item => getItemTags(item))
  ]);
}

function formatSoldDate(date) {
  if (!date) return '';
  return new Date(date).toLocaleDateString('it-IT');
}

function ensureEditModalLoaded() {
  if (!isCurrentAdmin() || window.editModalInitialized || document.querySelector('script[data-admin-edit-modal]')) return;

  const script = document.createElement('script');
  script.src = 'edit-modal.js';
  script.dataset.adminEditModal = 'true';
  document.body.appendChild(script);
}
window.preferitiData = {};        // ← NEW: global favorites per user

// --------------------- PERMALINK SUPPORT ---------------------
function updateItemPermalink(uuid) {
  const url = new URL(window.location);
  if (uuid) {
    url.searchParams.set('item', uuid);
  } else {
    url.searchParams.delete('item');
  }
  window.history.pushState({ item: uuid }, '', url);
}

function restoreFromPermalink() {
  const params = new URLSearchParams(window.location.search);
  const uuid = params.get('item');
  if (uuid && allItems.length > 0) {
    const item = allItems.find(i => i.UUID === uuid);
    if (item) {
      openModal(item);
    } else {
      console.warn('Permalink item not found:', uuid);
    }
  }
}
// --------------------- END PERMALINK SUPPORT ---------------------

async function init() {
  try {
    loadFilterState();
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
  renderTagCloud();
  setupInlineTagging();
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

  // Restore permalink on initial load + handle browser back/forward
  restoreFromPermalink();

  window.addEventListener('popstate', () => {
    restoreFromPermalink();
  });

  // Close modal on Esc key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('modal').classList.contains('hidden')) {
      closeModal();
    }
  });

  // Close modal when clicking outside the content (on overlay)
  document.getElementById('modal').addEventListener('click', (e) => {
    // If the click is directly on the modal overlay (not on child elements like the dialog box)
    if (e.target === document.getElementById('modal')) {
      closeModal();
    }
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
    await loadTagsForItems();
    await loadPositionData();
    await loadStatusForCurrentUser();

  } catch (e) {
    console.error("Caricamento fallito:", e);
    allItems = [];
  }
}

async function loadStatusForCurrentUser() {
  try {
    window.allStatus = {};
    window.adminStatusDetails = {};

    if (isCurrentAdmin()) {
      const snapshot = await db.ref('status').once('value');
      const statusData = snapshot.val() || {};

      Object.entries(statusData).forEach(([uuid, entry]) => {
        window.allStatus[uuid] = {
          stato: entry?.stato || '',
          prezzo: entry?.prezzo || ''
        };

        if (entry?.vendutoA || entry?.data) {
          window.adminStatusDetails[uuid] = {
            vendutoA: entry.vendutoA || '',
            data: entry.data || ''
          };
        }
      });
    } else {
      await Promise.all(allItems.map(async item => {
        const [statusSnapshot, priceSnapshot] = await Promise.all([
          db.ref(`status/${item.UUID}/stato`).once('value'),
          db.ref(`status/${item.UUID}/prezzo`).once('value')
        ]);

        const stato = statusSnapshot.val() || '';
        const prezzo = priceSnapshot.val() || '';
        if (stato || prezzo) {
          window.allStatus[item.UUID] = { stato, prezzo };
        }
      }));
    }

    allItems.forEach(item => {
      item.Status = window.allStatus[item.UUID]?.stato || '';
    });

    ensureEditModalLoaded();
    console.log('Status caricati da Firebase:', Object.keys(window.allStatus).length);
  } catch (e) {
    console.warn('Impossibile caricare status da Firebase (normale se offline)', e);
  }
}

window.reloadStatusForCurrentUser = async function () {
  if (allItems.length === 0) return;
  await loadStatusForCurrentUser();
  await loadPositionData();
  displayed = 0;
  renderGrid();
};

function getAdminSoldDetailsHtml(item) {
  if (!isCurrentAdmin() || !isUnavailableStatus((item.Status || '').trim())) return '';

  const details = window.adminStatusDetails?.[item.UUID] || {};
  const soldTo = details.vendutoA;
  const soldDate = details.data;

  if (!soldTo && !soldDate) return '';

  return `
    <div class="text-xs text-gray-600 leading-tight mt-1">
      ${soldTo ? `a <strong>${escapeHtml(soldTo)}</strong>` : ''}
      ${soldTo && soldDate ? '<br>' : ''}
      ${soldDate ? `il ${formatSoldDate(soldDate)}` : ''}
    </div>`;
}

function renderTagEditButton(item) {
  if (!isTagMode || !isCurrentAdmin()) return '';

  const id = item.UUID;
  const pending = Array.from(pendingTagWrites).some(key => key.startsWith(`${id}:`));

  return `
    <button type="button"
            class="inline-tag-edit absolute bottom-2 left-2 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-indigo-700 shadow-md backdrop-blur-sm transition hover:bg-indigo-600 hover:text-white ${pending ? 'cursor-wait opacity-60' : ''}"
            data-id="${escapeHtml(id)}"
            aria-label="Modifica tags"
            ${pending ? 'disabled' : ''}>
      <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.4">
        <path stroke-linecap="round" stroke-linejoin="round" d="M7 7h.01M3 11.2V5a2 2 0 0 1 2-2h6.2a2 2 0 0 1 1.4.6l7.8 7.8a2 2 0 0 1 0 2.8l-6.2 6.2a2 2 0 0 1-2.8 0L3.6 12.6a2 2 0 0 1-.6-1.4Z" />
      </svg>
    </button>
  `;
}

function getMobileTagEditorPosition(anchor) {
  const rect = anchor.getBoundingClientRect();
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 640;
  const margin = 16;
  const gap = 8;
  const preferredHeight = Math.min(360, viewportHeight - margin * 2);
  const spaceBelow = viewportHeight - rect.bottom - margin - gap;
  const spaceAbove = rect.top - margin - gap;
  const openBelow = spaceBelow >= Math.min(220, preferredHeight) || spaceBelow >= spaceAbove;
  const top = openBelow
    ? Math.min(rect.bottom + gap, viewportHeight - margin - 160)
    : Math.max(margin, rect.top - preferredHeight - gap);
  const maxHeight = Math.max(160, openBelow ? viewportHeight - top - margin : rect.top - margin - gap);

  return {
    top: Math.round(top),
    maxHeight: Math.round(Math.min(preferredHeight, maxHeight))
  };
}

function getInlineTagEditorStyle() {
  if (window.matchMedia?.('(min-width: 768px)').matches || !activeTagEditorPosition) return '';
  return `style="top: ${activeTagEditorPosition.top}px; bottom: auto; max-height: ${activeTagEditorPosition.maxHeight}px;"`;
}

function focusActiveTagInput() {
  requestAnimationFrame(() => {
    document.querySelector('.inline-tag-editor .inline-tag-input')?.focus();
  });
}

function renderInlineTagEditor(item) {
  const id = item.UUID;
  if (!isTagMode || activeTagEditorId !== id || !isCurrentAdmin()) return '';

  const currentTags = getItemTags(item);
  const suggestions = tagCatalog
    .filter(tag => !currentTags.includes(tag))
    .slice(0, 8);

  return `
    <div class="inline-tag-editor fixed inset-x-4 z-50 overflow-y-auto rounded-xl border border-gray-200 bg-white p-3 text-left shadow-2xl md:absolute md:inset-x-3 md:top-12 md:max-h-80"
         data-id="${escapeHtml(id)}"
         ${getInlineTagEditorStyle()}>
      <div class="mb-2 flex items-center justify-between gap-2">
        <div class="min-w-0">
          <p class="text-xs font-semibold uppercase text-gray-500">Tags</p>
          <p class="truncate text-xs text-gray-600">${escapeHtml(item['Serial No'] || item.Item || id)}</p>
        </div>
        <button type="button" class="inline-tag-close rounded-full px-2 text-xl leading-none text-gray-400 hover:text-gray-800" aria-label="Chiudi editor tags">&times;</button>
      </div>
      <div class="mb-3 flex max-h-32 flex-wrap gap-1.5 overflow-y-auto md:max-h-24">
        ${currentTags.length ? currentTags.map(tag => `
          <button type="button"
                  class="inline-tag-remove rounded-full bg-indigo-600 px-2 py-1 text-xs leading-none text-white hover:bg-red-600"
                  data-id="${escapeHtml(id)}"
                  data-tag="${escapeHtml(tag)}">
            #${escapeHtml(displayTag(tag))} &times;
          </button>
        `).join('') : '<span class="text-xs text-gray-500">No tags</span>'}
      </div>
      <form class="inline-tag-form flex gap-2" data-id="${escapeHtml(id)}">
        <input class="inline-tag-input min-w-0 flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-xs outline-none focus:border-indigo-500"
               list="gridTagSuggestions"
               placeholder="Aggiungi tag">
        <button type="submit" class="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700">Add</button>
      </form>
      ${suggestions.length ? `
        <div class="mt-2 flex flex-wrap gap-1.5">
          ${suggestions.map(tag => `
            <button type="button"
                    class="inline-tag-add rounded-full bg-gray-100 px-2 py-1 text-xs leading-none text-gray-700 hover:bg-indigo-50 hover:text-indigo-700"
                    data-id="${escapeHtml(id)}"
                    data-tag="${escapeHtml(tag)}">
              #${escapeHtml(displayTag(tag))}
            </button>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

function getItemStatus(item) {
  return (item?.Status || '').trim();
}

function isUnavailableStatus(status) {
  return status === 'Venduto' || status === 'Consegnato';
}

function matchesStatusFilter(status, statusFilter) {
  if (!statusFilter) return true;
  if (statusFilter === 'Disponibile') return !isUnavailableStatus(status);
  return status === statusFilter;
}

function renderStatusBadge(item) {
  const status = getItemStatus(item);

  if (status === 'Venduto') {
    return `<span class="bg-red-100 text-red-800 text-xs px-2 py-1 rounded">Venduto</span>${getAdminSoldDetailsHtml(item)}`;
  }

  if (status === 'Consegnato') {
    return `<span class="bg-red-700 text-white text-xs px-2 py-1 rounded">Consegnato</span>${getAdminSoldDetailsHtml(item)}`;
  }

  return '<span class="bg-green-100 text-green-800 text-xs px-2 py-1 rounded">Disponibile</span>';
}

function setupInlineTagging() {
  ensureTagModeButton();
  updateTagModeUI();

  if (!document.getElementById('gridTagSuggestions')) {
    const datalist = document.createElement('datalist');
    datalist.id = 'gridTagSuggestions';
    document.body.appendChild(datalist);
  }
  renderGridTagSuggestions();

  if (document.body.dataset.inlineTaggingBound) return;

  document.addEventListener('click', handleInlineTagClick);
  document.addEventListener('submit', handleInlineTagSubmit);
  window.addEventListener('san-gottardo-auth-changed', () => {
    if (!isCurrentAdmin()) {
      activeTagEditorId = null;
      activeTagEditorPosition = null;
    }
    updateTagModeUI();
    refreshGridPreservingDisplay();
  });
  document.body.dataset.inlineTaggingBound = 'true';
}

function ensureTagModeButton() {
  if (document.getElementById('tagModeBtn')) return;

  const adminBtn = document.getElementById('adminBtn');
  if (!adminBtn?.parentElement) return;

  const button = document.createElement('button');
  button.id = 'tagModeBtn';
  button.type = 'button';
  button.className = 'hidden bg-gray-700 hover:bg-gray-800 text-white px-4 py-2 rounded text-sm font-medium transition shadow-md';
  button.addEventListener('click', () => {
    isTagMode = !isTagMode;
    activeTagEditorId = null;
    activeTagEditorPosition = null;
    updateTagModeUI();
    refreshGridPreservingDisplay();
  });

  adminBtn.parentElement.insertBefore(button, adminBtn);
}

function updateTagModeUI() {
  const button = document.getElementById('tagModeBtn');
  if (!button) return;

  const canTag = isCurrentAdmin();
  button.classList.toggle('hidden', !canTag);
  button.classList.toggle('bg-indigo-600', canTag && isTagMode);
  button.classList.toggle('hover:bg-indigo-700', canTag && isTagMode);
  button.classList.toggle('bg-gray-700', !isTagMode);
  button.classList.toggle('hover:bg-gray-800', !isTagMode);
  button.textContent = isTagMode ? 'Tag mode on' : 'Tag mode';
}

function renderGridTagSuggestions() {
  const datalist = document.getElementById('gridTagSuggestions');
  if (!datalist) return;

  const allTags = new Set(tagCatalog);
  allItems.forEach(item => getItemTags(item).forEach(tag => allTags.add(tag)));
  datalist.innerHTML = Array.from(allTags).sort()
    .map(tag => `<option value="${escapeHtml(tag)}"></option>`)
    .join('');
}

function refreshGridPreservingDisplay() {
  const grid = document.getElementById('grid');
  if (!grid) return;

  const target = Math.max(displayed || PAGE_SIZE, PAGE_SIZE);
  grid.innerHTML = '';
  displayed = 0;

  do {
    const before = displayed;
    renderGrid(true);
    if (displayed === before) break;
  } while (displayed < Math.min(target, filterItems().length));
}

async function ensureGridCatalogTag(tag) {
  const normalized = normalizeTag(tag);
  if (!normalized) return null;

  const isNew = !tagCatalog.includes(normalized);
  if (isNew) {
    tagCatalog = normalizeTags([...tagCatalog, normalized]);
    renderGridTagSuggestions();
    renderTagCloud();
  }

  if (isNew) {
    try {
      await db.ref(`status/__tagCatalog/${normalized}`).set(true);
    } catch (err) {
      tagCatalog = tagCatalog.filter(existing => existing !== normalized);
      renderGridTagSuggestions();
      renderTagCloud();
      throw err;
    }
  }

  return normalized;
}

async function writeItemStatusTags(id, tags) {
  const ref = db.ref(`status/${id}`);
  const snapshot = await ref.once('value').catch(() => null);
  const current = snapshot?.val?.() || {};

  if (tags.length) current.tags = tags;
  else delete current.tags;

  if (Object.keys(current).length) await ref.set(current);
  else await ref.remove();
}

async function saveGridItemTags(id, tags, pendingKey) {
  if (!window.requireFirebaseAdminAuth?.() || pendingTagWrites.has(pendingKey)) return;

  const item = allItems.find(candidate => candidate.UUID === id);
  if (!item) return;

  const previous = getItemTags(item);
  const normalized = normalizeTags(tags);
  item.Tags = normalized;
  itemTags[id] = normalized;
  pendingTagWrites.add(pendingKey);
  renderGridTagSuggestions();
  refreshGridPreservingDisplay();
  renderTagCloud();

  try {
    await writeItemStatusTags(id, normalized);
  } catch (err) {
    item.Tags = previous;
    itemTags[id] = previous;
    console.warn('Tag save failed', err);
    alert('Tag save failed. Please check Firebase permissions and try again.');
  } finally {
    pendingTagWrites.delete(pendingKey);
    renderGridTagSuggestions();
    refreshGridPreservingDisplay();
    renderTagCloud();
  }
}

async function addGridTag(id, rawTag) {
  const item = allItems.find(candidate => candidate.UUID === id);
  if (!item) return;

  const tag = await ensureGridCatalogTag(rawTag);
  if (!tag) return;

  await saveGridItemTags(id, [...getItemTags(item), tag], `${id}:${tag}`);
}

async function removeGridTag(id, tag) {
  const item = allItems.find(candidate => candidate.UUID === id);
  if (!item) return;

  const normalized = normalizeTag(tag);
  await saveGridItemTags(
    id,
    getItemTags(item).filter(existing => existing !== normalized),
    `${id}:${normalized}`
  );
}

function handleInlineTagClick(event) {
  if (event.target.closest('#tagModeBtn')) return;

  const tagEditor = event.target.closest('.inline-tag-editor');
  const editButton = event.target.closest('.inline-tag-edit');
  const closeButton = event.target.closest('.inline-tag-close');
  const addButton = event.target.closest('.inline-tag-add');
  const removeButton = event.target.closest('.inline-tag-remove');

  if (editButton) {
    event.preventDefault();
    event.stopPropagation();
    const isClosing = activeTagEditorId === editButton.dataset.id;
    const nextId = editButton.dataset.id;
    const nextPosition = getMobileTagEditorPosition(editButton.closest('[data-uuid]') || editButton);

    activeTagEditorId = null;
    activeTagEditorPosition = null;
    refreshGridPreservingDisplay();

    if (!isClosing) {
      requestAnimationFrame(() => {
        activeTagEditorId = nextId;
        activeTagEditorPosition = nextPosition;
        refreshGridPreservingDisplay();
        focusActiveTagInput();
      });
    }
    return;
  }

  if (closeButton) {
    event.preventDefault();
    event.stopPropagation();
    activeTagEditorId = null;
    activeTagEditorPosition = null;
    refreshGridPreservingDisplay();
    return;
  }

  if (addButton) {
    event.preventDefault();
    event.stopPropagation();
    addGridTag(addButton.dataset.id, addButton.dataset.tag);
    return;
  }

  if (removeButton) {
    event.preventDefault();
    event.stopPropagation();
    removeGridTag(removeButton.dataset.id, removeButton.dataset.tag);
    return;
  }

  if (tagEditor) event.stopPropagation();
}

function handleInlineTagSubmit(event) {
  if (!event.target.classList.contains('inline-tag-form')) return;

  event.preventDefault();
  event.stopPropagation();

  const input = event.target.querySelector('.inline-tag-input');
  const id = event.target.dataset.id;
  const value = input?.value || '';
  if (input) input.value = '';
  addGridTag(id, value);
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
  const statusFilter = document.getElementById('statusFilter')?.value || '';

  return allItems.filter(item => {
    const tags = getItemTags(item);
    const box = getItemBox(item);
    const adminPositionTerms = isCurrentAdmin() ? [box, getBoxLocation(box), getLooseItemLocation(item)] : [];
    const searchText = [item.Item, item.Location, item.Notes, item['Serial No'], ...adminPositionTerms, ...tags].join(' ').toLowerCase();
    const matchSearch = !q || searchText.includes(q);
    const matchTags = !selectedTags.size || tags.includes([...selectedTags][0]);

    const matchStatus = matchesStatusFilter(getItemStatus(item), statusFilter);

    return matchSearch && matchTags && matchStatus;
  });
}

function setupCategoryFiltersLegacy() {
  const sel = document.getElementById('legacyCategoryFilter');

  // Crea dropdown Status UNA VOLTA SOLA (se non esiste)
  let statusSel = document.getElementById('statusFilter');
  if (!statusSel) {
    statusSel = document.createElement('select');
    statusSel.id = 'statusFilter';
    statusSel.className = 'ml-2 p-2 border rounded';
    statusSel.innerHTML = `<option value="">All Status</option><option value="Disponibile">Disponibile</option><option value="Venduto">Venduto</option><option value="Consegnato">Consegnato</option>`;
    document.querySelector('#filters').appendChild(statusSel);
  }

  function updateCategoryCounts() {
    const currentStatus = statusSel.value;
    const filteredItems = filterItems(); // Usa il filtro Status corrente

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
  }

  // Aggiorna alla prima apertura
  updateCategoryCounts();

  // Listener per Status — ricalcola categorie
  statusSel.addEventListener('change', () => {
    displayed = 0;
    renderGrid();
    updateCategoryCounts();
  });

  // Listener per ricerca
  let timeout;
  document.getElementById('search').addEventListener('input', () => {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      displayed = 0;
      renderGrid();
      updateCategoryCounts();
    }, 300);
  });

  // Listener per categoria
  sel.addEventListener('change', () => {
    displayed = 0;
    renderGrid();
    const url = new URL(window.location);
    sel.value ? url.searchParams.set('cat', sel.value) : url.searchParams.delete('cat');
    window.history.replaceState({}, '', url);
  });

  // Ripristina da URL
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

  // BOTTONE CLEAR FILTERS
  const clearBtn = document.getElementById('clearFilters');
  clearBtn.parentNode.insertBefore(statusSel, clearBtn);
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      // Resetta dropdown
      sel.value = '';
      statusSel.value = '';

      // ←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←
      // RESET DELLA SEARCH BOX
      document.getElementById('search').value = '';
      // ←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←

      // Resetta griglia
      displayed = 0;
      renderGrid();

      // Aggiorna i conteggi delle categorie
      updateCategoryCounts();

      // Pulisci l'URL
      const url = new URL(window.location);
      url.searchParams.delete('cat');
      window.history.replaceState({}, '', url);
    });
  }
}

function setupFilters() {
  let statusSel = document.getElementById('statusFilter');
  if (!statusSel) {
    statusSel = document.createElement('select');
    statusSel.id = 'statusFilter';
    statusSel.className = 'p-2 border rounded';
    statusSel.innerHTML = `<option value="">All Status</option><option value="Disponibile">Disponibile</option><option value="Venduto">Venduto</option><option value="Consegnato">Consegnato</option>`;
  }

  const clearBtn = document.getElementById('clearFilters');
  clearBtn.parentNode.insertBefore(statusSel, clearBtn);

  statusSel.addEventListener('change', () => {
    displayed = 0;
    renderGrid();
    renderTagCloud();
  });

  let timeout;
  document.getElementById('search').addEventListener('input', () => {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      displayed = 0;
      renderGrid();
      renderTagCloud();
    }, 300);
  });

  const urlParams = new URLSearchParams(window.location.search);
  const urlTag = normalizeTag(urlParams.get('tag') || window.initialTagFilter || '');
  if (urlTag) {
    selectedTags = new Set([urlTag]);
    saveFilterState();
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      statusSel.value = '';
      selectedTags.clear();
      saveFilterState();
      document.getElementById('search').value = '';

      displayed = 0;
      renderGrid();
      renderTagCloud();

      const url = new URL(window.location);
      url.searchParams.delete('tag');
      url.searchParams.delete('cat');
      window.history.replaceState({}, '', url);
    });
  }
}

function renderTagCloud() {
  const cloud = document.getElementById('tagCloud');
  if (!cloud) return;

  const statusFilter = document.getElementById('statusFilter')?.value || '';
  const q = (document.getElementById('search')?.value || '').toLowerCase().trim();
  const counts = {};

  allItems.forEach(item => {
    const matchStatus = matchesStatusFilter(getItemStatus(item), statusFilter);
    const tags = getItemTags(item);
    const box = getItemBox(item);
    const adminPositionTerms = isCurrentAdmin() ? [box, getBoxLocation(box), getLooseItemLocation(item)] : [];
    const searchText = [item.Item, item.Location, item.Notes, item['Serial No'], ...adminPositionTerms, ...tags].join(' ').toLowerCase();
    const matchSearch = !q || searchText.includes(q);
    if (!matchStatus || !matchSearch) return;
    tags.forEach(tag => {
      counts[tag] = (counts[tag] || 0) + 1;
    });
  });

  const tags = normalizeTags([...tagCatalog, ...Object.keys(counts)])
    .filter(tag => counts[tag] || selectedTags.has(tag));

  if (!tags.length) {
    cloud.innerHTML = '<p class="text-sm text-gray-500">Nessun tag disponibile.</p>';
    return;
  }

  cloud.innerHTML = `
    ${tags.map(tag => {
      const active = selectedTags.has(tag);
      return `
        <button type="button"
                data-tag="${escapeHtml(tag)}"
                class="tag-filter px-3 py-1.5 text-sm rounded-full transition ${active ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-300 text-gray-700 hover:border-indigo-400 hover:text-indigo-700'}"
                aria-pressed="${active}">
          #${escapeHtml(displayTag(tag))} <span class="${active ? 'text-indigo-100' : 'text-gray-400'}">${counts[tag] || 0}</span>
        </button>`;
    }).join('')}
    <button id="clearTagFilters"
            type="button"
            class="px-3 py-1.5 text-sm rounded-full border border-gray-300 text-gray-600 hover:text-gray-900 transition ${selectedTags.size ? '' : 'hidden'}">
      Clear tags
    </button>
  `;

  cloud.querySelectorAll('.tag-filter').forEach(button => {
    button.addEventListener('click', () => toggleTagFilter(button.dataset.tag));
  });
  document.getElementById('clearTagFilters')?.addEventListener('click', clearTagFilters);
}

function toggleTagFilter(tag) {
  const normalized = normalizeTag(tag);
  if (!normalized) return;

  if (selectedTags.has(normalized)) selectedTags.delete(normalized);
  else selectedTags = new Set([normalized]);

  saveFilterState();
  displayed = 0;
  renderTagCloud();
  renderGrid();

  const url = new URL(window.location);
  selectedTags.size ? url.searchParams.set('tag', [...selectedTags][0]) : url.searchParams.delete('tag');
  url.searchParams.delete('cat');
  window.history.replaceState({}, '', url);
}

function clearTagFilters() {
  selectedTags.clear();
  saveFilterState();
  displayed = 0;
  renderTagCloud();
  renderGrid();
  const url = new URL(window.location);
  url.searchParams.delete('tag');
  url.searchParams.delete('cat');
  window.history.replaceState({}, '', url);
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

  // ←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←
  // MESSAGGIO "NESSUN RISULTATO" PERSONALIZZATO
  if (filtered.length === 0) {
    const tag = selectedTags.size ? `#${displayTag([...selectedTags][0])}` : 'tutti i tag';
    const status = document.getElementById('statusFilter')?.value || 'tutti gli stati';
    const statusText = status === 'Disponibile' ? 'disponibili' :
      status === 'Venduto' ? 'venduti' :
      status === 'Consegnato' ? 'consegnati' : status;

    const message = document.createElement('div');
    message.className = 'col-span-full text-center py-12 text-gray-500';
    message.innerHTML = `
      <p class="text-lg">Nessun risultato per</p>
      <p class="text-xl font-medium mt-2">${escapeHtml(tag)} — ${statusText}</p>
      <p class="text-sm mt-4">Prova a cambiare i filtri o la ricerca</p>
    `;
    container.appendChild(message);
    document.getElementById('loadMore').classList.add('hidden');
    renderPreferitiSidebar();
    return;
  }

  for (let i = start; i < end; i++) {
    const item = filtered[i];
    const div = document.createElement('div');
    const isEditingTags = isTagMode && activeTagEditorId === item.UUID;
    div.className = `bg-white rounded ${isEditingTags ? 'overflow-visible z-30' : 'overflow-hidden'} shadow cursor-pointer hover:shadow-lg transition-shadow relative`;

    div.dataset.uuid = item.UUID;

    const itemTagsHtml = getItemTags(item).slice(0, 3).map(tag =>
      `<span class="inline-flex items-center rounded-full bg-indigo-50 text-indigo-700 px-2 py-0.5 text-xs">#${escapeHtml(displayTag(tag))}</span>`
    ).join('');

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

    const editButton = isCurrentAdmin() ? `
      <button onclick="event.stopPropagation(); openEditModal('${item.UUID}')" 
              class="absolute top-2 left-2 bg-white/90 hover:bg-white rounded-full p-2 shadow-md transition z-10">
        <svg class="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
        </svg>
      </button>` : '';
    const tagEditButton = renderTagEditButton(item);
    const tagEditor = renderInlineTagEditor(item);

    const statusHtml = renderStatusBadge(item);
    const positionLine = getAdminPositionLine(item);
    const positionHtml = positionLine
      ? `<p class="text-xs text-gray-500">${positionLine}</p>`
      : '';

    div.innerHTML = `
      <div class="bg-gray-100 flex items-center justify-center rounded-t-lg h-48 relative overflow-hidden">
        <img src="images/${item.Photos[0]}" alt="${item.Item}" class="max-h-full max-w-full object-contain transition-transform hover:scale-105" onerror="this.src='images/placeholder.jpg'">
        ${photoCountBadge}
        ${heartIcon}
        ${editButton}
        ${tagEditButton}
      </div>
      ${tagEditor}
      <div class="p-3 flex flex-col justify-between bg-white" style="min-height: 8rem;">
        <div>
          <h3 class="font-semibold text-sm line-clamp-2 leading-tight">${item.Item}</h3>
          <div class="flex flex-wrap gap-1 mt-2">${itemTagsHtml || '<span class="text-xs text-gray-500">No tags</span>'}</div>
          <p class="text-xs text-gray-500">ID: ${item['Serial No'] || '—'}</p>
          ${positionHtml}
        </div>
        <div class="flex justify-between items-start gap-3">
          <p class="text-sm font-medium text-indigo-600">Prezzo: ${formatPrice(item)}</p>
          <div class="mt-1 text-right">${statusHtml}</div>
        </div>
      </div>
    `;

    div.onclick = (e) => {
      if (!e.target.closest('button, .inline-tag-editor')) openModal(item);
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
  // ← Added for permalink
  updateItemPermalink(item.UUID);
  const tagsHtml = getItemTags(item).map(tag =>
    `<span class="inline-flex items-center rounded-full bg-indigo-50 text-indigo-700 px-2 py-0.5 text-xs mr-1 mb-1">#${escapeHtml(displayTag(tag))}</span>`
  ).join('');

  document.getElementById('modalTitle').textContent = item.Item;
  const adminPositionLine = getAdminPositionLine(item);
  const adminPositionHtml = adminPositionLine
    ? `<strong>${adminPositionLine.split(':')[0]}:</strong>${adminPositionLine.slice(adminPositionLine.indexOf(':') + 1)}<br>`
    : '';
  document.getElementById('modalDesc').innerHTML = `
    <strong>ID:</strong> ${item['Serial No'] || '—'}<br>
    <strong>Tags:</strong> <span class="inline-flex flex-wrap gap-1 align-middle">${tagsHtml || '—'}</span><br>
    <strong>Category:</strong> ${item.Location || '—'}<br>
    ${adminPositionHtml}
    ${item.Notes ? `<strong>Notes:</strong><br><span class="text-sm italic text-gray-700">${item.Notes.replace(/\n/g, '<br>')}</span><br>` : ''}
    ${item['Purchase Date'] ? `<strong>Purchased:</strong> ${item['Purchase Date']}<br>` : ''}
    <strong>Prezzo:</strong> ${formatPrice(item)}
  `;

  const wrapper = document.getElementById('swiperWrapper');
  wrapper.innerHTML = '';
  item.Photos.forEach((src, idx) => {
    const slide = document.createElement('div');
    slide.className = 'swiper-slide flex items-center justify-center bg-gray-100';
    slide.innerHTML = `
  <div class="swiper-zoom-container">
    <img src="images/${src}" alt="${item.Item} - ${idx + 1}" 
         class="max-w-full max-h-full object-contain" 
         onerror="this.src='images/placeholder.jpg'">
  </div>
`; wrapper.appendChild(slide);
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
    initialSlide: 0,

    // ── ZOOM ACTIVATION ──
    zoom: {
      maxRatio: 4,           // how much you can zoom (4× is usually plenty for photos)
      limitToOriginalSize: false,   // ← very recommended for archival photos
      minRatio: 1,
      toggle: true,          // double-tap toggles zoom (very natural)
      panOnMouseMove: true   // nice on desktop – pan while zoomed
    }
  });

  currentSwiper.on('slideChange', () => {
    currentSwiper.zoom.out();
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
  // Prevent background scroll while modal is open
  document.body.style.overflow = 'hidden';

  // Focus the modal for better keyboard accessibility
  document.getElementById('modal').focus();
  document.getElementById('closeModal').onclick = closeModal;
}

function closeModal() {
  document.getElementById('modal').classList.add('hidden');
  // Restore normal scrolling
  document.body.style.overflow = '';
  document.querySelector('.swiper button[data-heart]')?.remove();

  if (currentSwiper) {
    currentSwiper.destroy(true, true);
    currentSwiper = null;
  }

  // ← Added for permalink
  updateItemPermalink(null);  // removes ?item=...
}
