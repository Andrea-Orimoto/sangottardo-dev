// edit-modal.js — versione bellissima + mobile-friendly

if (!window.editModalInitialized) {
  window.editModalInitialized = true;

  const modalHTML = `
<div id="editModal" class="fixed inset-0 bg-black/70 flex items-center justify-center z-50 hidden">
  <div class="bg-white rounded-2xl shadow-2xl max-w-3xl w-full mx-4 overflow-hidden">
    
    <!-- Header con foto, nome e ID -->
    <div class="bg-gradient-to-br from-indigo-600 to-purple-700 text-white p-6 sm:p-8">
      <div class="flex items-start gap-4 sm:gap-6">
        <img id="editModalPhoto" src="images/placeholder.jpg" alt="Oggetto" 
             class="w-24 h-24 sm:w-32 sm:h-32 object-cover rounded-xl shadow-lg border-4 border-white/30 flex-shrink-0">
        <div class="flex-1 pt-1 sm:pt-2">
          <h2 id="editModalTitle" class="text-2xl sm:text-3xl font-bold leading-tight">
            Caricamento...
          </h2>
          <p class="text-base sm:text-xl opacity-90 mt-1 sm:mt-2">
            ID: <span id="editModalID" class="font-mono">—</span>
          </p>
        </div>
      </div>
    </div>

    <!-- Campi editing -->
    <div class="p-6 sm:p-8 space-y-6">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label class="block text-sm font-semibold text-gray-700 mb-2">Prezzo vendita</label>
          <input type="text" id="editPrice" class="w-full border-2 border-gray-300 rounded-lg px-4 py-3 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 transition" placeholder="2800 EUR">
        </div>

        <div>
          <label class="block text-sm font-semibold text-gray-700 mb-2">Stato</label>
          <select id="editStatus" class="w-full border-2 border-gray-300 rounded-lg px-4 py-3 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200">
            <option value="">Disponibile</option>
            <option value="Venduto">Venduto</option>
          </select>
        </div>
      </div>

      <div id="soldFields" class="space-y-6 hidden bg-gray-50 -mx-6 sm:-mx-8 -mb-6 sm:-mb-8 p-6 sm:p-8 rounded-b-2xl">
        <div>
          <label class="block text-sm font-semibold text-gray-700 mb-2">Venduto a</label>
          <input type="text" id="editBuyer" class="w-full border-2 border-gray-300 rounded-lg px-4 py-3" placeholder="Nome cliente">
        </div>
        <div>
          <label class="block text-sm font-semibold text-gray-700 mb-2">Data vendita</label>
          <input type="date" id="editDate" class="w-full border-2 border-gray-300 rounded-lg px-4 py-3">
        </div>
      </div>
    </div>

    <!-- Pulsanti -->
    <div class="flex justify-end gap-4 px-6 sm:px-8 pb-6 sm:pb-8">
      <button onclick="closeEditModal()" class="px-6 sm:px-8 py-3 bg-gray-200 hover:bg-gray-300 rounded-xl font-semibold transition">
        Annulla
      </button>
      <button onclick="saveObjectStatus()" class="px-8 sm:px-10 py-3 bg-gradient-to-r from-indigo-600 to-purple-700 hover:from-indigo-700 hover:to-purple-800 text-white rounded-xl font-bold shadow-lg transition">
        Salva modifiche
      </button>
    </div>
  </div>
</div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHTML);

  window.currentEditingUUID = null;

  window.openEditModal = async function (uuid) {
    if (!window.currentUser || !window.isAdmin(window.currentUser)) return;

    window.currentEditingUUID = uuid;
    const item = allItems.find(i => i.UUID === uuid);

    if (!item) return;

    // LEGGI SEMPRE I DATI FRESCHI DA FIREBASE (non da cache!)
    let statusInfo = {};
    try {
      const snap = await db.ref('status/' + uuid).once('value');
      statusInfo = snap.val() || {};
    } catch (e) {
      console.warn("Impossibile leggere status da Firebase:", e);
    }

    // Header
    document.getElementById('editModalPhoto').src =
      item.Photos?.[0] ? `images/${item.Photos[0]}` : 'images/placeholder.jpg';
    document.getElementById('editModalTitle').textContent = item.Item;
    document.getElementById('editModalID').textContent = item['Serial No'] || '—';

    // Campi — usa i dati FRESCHI
    document.getElementById('editPrice').value = statusInfo.prezzo || '';
    document.getElementById('editStatus').value = item.Status || '';
    document.getElementById('editBuyer').value = statusInfo.vendutoA || '';
    document.getElementById('editDate').value = statusInfo.data || '';

    const soldFields = document.getElementById('soldFields');
    soldFields.classList.toggle('hidden', (item.Status || '') !== 'Venduto');

    document.getElementById('editStatus').onchange = function () {
      soldFields.classList.toggle('hidden', this.value !== 'Venduto');
    };

    document.getElementById('editModal').classList.remove('hidden');
  };

  window.closeEditModal = function () {
    document.getElementById('editModal').classList.add('hidden');
    window.currentEditingUUID = null;
  };

window.saveObjectStatus = async function () {
    if (!window.currentEditingUUID) return;

    const status = document.getElementById('editStatus').value;
    const prezzo = document.getElementById('editPrice').value.trim();
    const buyer = document.getElementById('editBuyer').value.trim();
    const date = document.getElementById('editDate').value;

    const payload = {
        stato: status || null,
        prezzo: prezzo || null,
        vendutoA: (status === 'Venduto' && buyer) ? buyer : null,
        data: (status === 'Venduto' && date) ? date : null
    };

    Object.keys(payload).forEach(key => payload[key] === null && delete payload[key]);

    try {
        if (Object.keys(payload).length === 0) {
            await db.ref('status/' + window.currentEditingUUID).remove();
        } else {
            await db.ref('status/' + window.currentEditingUUID).set(payload);
        }

        const item = allItems.find(i => i.UUID === window.currentEditingUUID);
        if (item) item.Status = status || '';

        // AGGIORNAMENTO UNIVERSALE — FUNZIONA SU INDEX E ADMIN
        document.querySelectorAll(`[data-uuid="${window.currentEditingUUID}"]`).forEach(card => {

            // === INDEX.HTML (griglia) ===
            const indexBadge = card.querySelector('.flex.justify-between.items-center > div:last-child');
            if (indexBadge) {
                let html = '';
                if (status === 'Venduto') html = '<span class="bg-red-100 text-red-800 text-xs px-2 py-1 rounded">Venduto</span>';
                else if (status === 'Prenotato') html = '<span class="bg-yellow-100 text-yellow-800 text-xs px-2 py-1 rounded">Prenotato</span>';
                else html = '<span class="bg-green-100 text-green-800 text-xs px-2 py-1 rounded">Disponibile</span>';
                indexBadge.innerHTML = html;
            }

            const indexPrice = card.querySelector('.text-indigo-600.font-medium');
            if (indexPrice) {
                const label = indexPrice.textContent.split(':')[0] + ':';
                indexPrice.innerHTML = `<span class="text-sm font-medium text-indigo-600">${label} ${prezzo || '—'}</span>`;
            }

            // === ADMIN.HTML (entrambe le viste) ===
            const adminBadge = card.querySelector('.text-right');
            if (adminBadge) {
                let html = '';
                if (status === 'Venduto') {
                    html = `
                        <div class="text-right">
                            <span class="badge-venduto">VENDUTO</span>
                            ${buyer && date ? `
                                <div class="text-xs text-gray-600 mt-1 leading-tight">
                                    a <strong>${buyer}</strong><br>
                                    il ${new Date(date).toLocaleDateString('it-IT')}
                                </div>
                            ` : ''}
                        </div>`;
                } else if (status === 'Prenotato') {
                    html = '<div class="text-right"><span class="badge-prenotato">PRENOTATO</span></div>';
                } else {
                    html = '<div class="text-right"><span class="badge-disponibile">DISPONIBILE</span></div>';
                }
                adminBadge.innerHTML = html;
            }

            const adminPriceLine = card.querySelector('.text-sm.text-gray-600');
            if (adminPriceLine) {
                const parts = adminPriceLine.textContent.split(' • ');
                const base = parts[0];
                const pricePart = prezzo ? ` • Prezzo: <strong>${prezzo}</strong>` : '';
                adminPriceLine.innerHTML = base + pricePart;
            }
        });

        window.closeEditModal();
        alert('Oggetto aggiornato!');

    } catch (e) {
        console.error(e);
        alert('Errore salvataggio');
    }
};
}