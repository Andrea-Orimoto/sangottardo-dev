// admin.js — Sangottardo Admin Panel
const REPO = 'Andrea-Orimoto/sangottardo';
const GITHUB_TOKEN = 'YOUR_PAT_HERE'; // <-- REPLACE

let allItems = [];
let statusData = {};

// === UTILS ===
async function getFileSha(path) {
  try {
    const resp = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
      headers: { 'Authorization': `token ${GITHUB_TOKEN}` }
    });
    const data = await resp.json();
    return data.sha;
  } catch (e) { return null; }
}

// === GOOGLE USER ===
function initGoogleUser() {
  const profile = window.googleUser?.getBasicProfile();
  if (profile) {
    document.getElementById('userInfo').textContent = `Hi, ${profile.getName()} (${profile.getEmail()})`;
  }
}

// === LOAD ITEMS + STATUS ===
async function loadItemsAndStatus() {
  try {
    // Load items.csv
    const itemsResp = await fetch('data/items.csv');
    const itemsText = await itemsResp.text();
    const parsed = Papa.parse(itemsText, { header: true, skipEmptyLines: true });
    allItems = parsed.data;

    // Load status.json
    try {
      const statusResp = await fetch('data/status.json');
      statusData = statusResp.ok ? await statusResp.json() : {};
    } catch (e) { statusData = {}; }

    renderItems();
  } catch (e) {
    console.error("Failed to load items", e);
  }
}

// === RENDER ITEMS TABLE ===
function renderItems() {
  const tbody = document.getElementById('itemsBody');
  tbody.innerHTML = allItems.map(item => {
    const uuid = item.UUID;
    const currentStatus = (statusData[uuid] || '').trim();
    const displayStatus = currentStatus === '' || currentStatus === 'Attivo' || currentStatus === 'Disponibile' ? 'Attivo' : currentStatus;

    return `
      <tr class="border-b">
        <td class="px-4 py-2">${item.Item || ''}</td>
        <td class="px-4 py-2">${item.Location || ''}</td>
        <td class="px-4 py-2">€${item['Purchase Price'] || 'N/A'}</td>
        <td class="px-4 py-2">
          <select data-uuid="${uuid}" class="status-select p-1 border rounded text-sm">
            <option value="Disponibile" ${displayStatus === 'Disponibile' ? 'selected' : ''}>Disponibile</option>
            <option value="Venduto" ${displayStatus === 'Venduto' ? 'selected' : ''}>Venduto</option>
          </select>
        </td>
      </tr>
    `;
  }).join('');

  // Attach change listeners
  document.querySelectorAll('.status-select').forEach(sel => {
    sel.addEventListener('change', () => updateStatus(sel.dataset.uuid, sel.value));
  });
}

// === UPDATE STATUS ===
async function updateStatus(uuid, newStatus) {
  // Save blank for Attivo
  const saveStatus = newStatus === 'Attivo' ? '' : newStatus;

  try {
    statusData[uuid] = saveStatus;
    const sha = await getFileSha('data/status.json');

    await fetch(`https://api.github.com/repos/${REPO}/contents/data/status.json`, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: `Status: ${uuid} → ${saveStatus || 'Attivo'}`,
        content: btoa(JSON.stringify(statusData, null, 2)),
        sha
      })
    });

    Swal.fire('Success', 'Status updated!', 'success');
  } catch (e) {
    Swal.fire('Error', e.message, 'error');
  }
}

// === ADD ADMIN ===
document.getElementById('addAdminBtn')?.addEventListener('click', async () => {
  const email = document.getElementById('newAdminEmail').value.trim();
  if (!email || !email.includes('@')) {
    document.getElementById('adminMsg').textContent = 'Invalid email';
    return;
  }

  const msg = document.getElementById('adminMsg');
  msg.textContent = 'Adding...';

  try {
    const resp = await fetch('data/admins.json');
    let admins = resp.ok ? await resp.json() : [];
    if (admins.includes(email)) {
      msg.textContent = 'Already admin';
      return;
    }

    admins.push(email);
    const sha = await getFileSha('data/admins.json');
    await fetch(`https://api.github.com/repos/${REPO}/contents/data/admins.json`, {
      method: 'PUT',
      headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `Add admin: ${email}`, content: btoa(JSON.stringify(admins, null, 2)), sha })
    });

    msg.textContent = `Added ${email}!`;
    document.getElementById('newAdminEmail').value = '';
  } catch (e) {
    msg.textContent = 'Failed: ' + e.message;
  }
});

// === INIT ===
document.addEventListener('DOMContentLoaded', () => {
  initGoogleUser();
  loadItemsAndStatus();

  document.getElementById('refreshItems').onclick = loadItemsAndStatus;
  document.getElementById('logout').onclick = () => { localStorage.clear(); location.href = 'index.html'; };
});