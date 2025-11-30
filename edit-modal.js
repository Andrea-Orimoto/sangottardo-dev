// edit-modal.js — versione finale, sicura, funzionante ovunque

// Evita doppie dichiarazioni
if (!window.editModalInitialized) {
  window.editModalInitialized = true;

  // Inietta il modal una volta sola
  const modalHTML = `
<div id="editModal" class="fixed inset-0 bg-black/70 flex items-center justify-center z-50 hidden">
  <div class="bg-white rounded-xl shadow-2xl p-8 max-w-md w-full mx-4">
    <h2 class="text-2xl font-bold text-indigo-700 mb-6">Modifica oggetto</h2>

    <div class="space-y-5">
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">Prezzo vendita</label>
        <input type="text" id="editPrice" class="w-full border rounded-lg px-4 py-2 focus:ring-2 focus:ring-indigo-500" placeholder="2800 EUR">
      </div>

      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">Stato</label>
        <select id="editStatus" class="w-full border rounded-lg px-4 py-2 focus:ring-2 focus:ring-indigo-500">
          <option value="">Disponibile</option>
          <option value="Prenotato">Prenotato</option>
          <option value="Venduto">Venduto</option>
        </select>
      </div>

      <div id="soldFields" class="space-y-4 hidden">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Venduto a</label>
          <input type="text" id="editBuyer" class="w-full border rounded-lg px-4 py-2" placeholder="Nome cliente">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Data vendita</label>
          <input type="date" id="editDate" class="w-full border rounded-lg px-4 py-2">
        </div>
      </div>
    </div>

    <div class="flex justify-end gap-3 mt-8">
      <button onclick="closeEditModal()" class="px-5 py-2 bg-gray-300 hover:bg-gray-400 rounded-lg font-medium">
        Annulla
      </button>
      <button onclick="saveObjectStatus()" class="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium">
        Salva
      </button>
    </div>
  </div>
</div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHTML);

  // Variabili globali
  window.currentEditingUUID = null;

  // Funzioni globali
  window.openEditModal = function (uuid) {
    if (!window.currentUser || !window.isAdmin(window.currentUser)) return;

    window.currentEditingUUID = uuid;
    const item = allItems.find(i => i.UUID === uuid);
    const statusInfo = window.allStatus?.[uuid] || {};

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

      window.closeEditModal();

      // Ricarica vista corrente
      if (typeof loadAllFavorites === 'function') loadAllFavorites();
      if (typeof renderGrid === 'function') renderGrid();

      alert('Oggetto aggiornato!');
    } catch (e) {
      console.error(e);
      alert('Errore salvataggio');
    }
  };
}