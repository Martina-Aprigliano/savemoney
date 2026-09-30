// --- CONFIGURAZIONE SUPABASE ---
const SUPABASE_URL = "https://qsankatsfbunrqnejeeg.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_zj0gQGLvNmNOMrDdAgwqsQ_PhZAb4nD";

let supabaseClient = null;
if (window.supabase) {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// --- STATO GLOBALE DELL'APPLICAZIONE ---
const STORAGE_KEY = "savemoney_app_v2";

let currentUser = null;
let currentSheetId = null;
let editingSheetId = null;

// Gestione PIN temporaneo in digitazione
let pendingUserForPin = null;
let enteredPin = "";

// Callback per conferma modale data duplicata
let pendingDuplicateAction = null;

let state = {
    users: ["Martina", "Marika"],
    data: {
        Martina: { pin: null, sheets: [] },
        Marika: { pin: null, sheets: [] }
    }
};

const DEFAULT_CATEGORIES = [
    {
        key: "ricorrenti_base",
        title: "Spese Ricorrenti di Base",
        color: "#2563eb",
        badgeClass: "bg-[#2563eb]",
        items: [
            { id: "psi", name: "Sedute Psicologa (es. 4 sedute)", value: 0, max: 600 },
            { id: "metro", name: "Abbonamento Metro / Trasporti", value: 0, max: 150 }
        ]
    },
    {
        key: "uscite_spot",
        title: "Uscite ed Eventi Spot",
        color: "#22c55e",
        badgeClass: "bg-[#22c55e]",
        items: [
            { id: "aperitivo", name: "Aperitivo stasera", value: 0, max: 120 },
            { id: "cene", name: "Cene ed eventi weekend", value: 0, max: 250 }
        ]
    },
    {
        key: "spese_variabili",
        title: "Spese Quotidiane Variabili",
        color: "#eab308",
        badgeClass: "bg-[#eab308]",
        items: [
            { id: "spesa", name: "Spesa e alimentari", value: 0, max: 400 }
        ]
    }
];

// --- HELPER DATE: CALCOLO E BLOCCO DATA MASSIMA (OGGI LOCALE) ---
function getTodayDateString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function lockDateInputsToToday() {
    const today = getTodayDateString();
    ['modal-sheet-date', 'edit-sheet-date'].forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.setAttribute('max', today);
            input.max = today;
            input.addEventListener('keydown', (e) => e.preventDefault());
        }
    });
}

// --- FUNZIONI HELPER: ARROTONDAMENTO E DATE DEI FOGLI ---
function round2(num) {
    const val = Number(num) || 0;
    return Math.round((val + Number.EPSILON) * 100) / 100;
}

function formatCurrency(num) {
    const val = round2(num);
    return val % 1 === 0 ? val.toString() : val.toFixed(2);
}

function getLatestSheetDate() {
    if (!currentUser || !state.data[currentUser] || !state.data[currentUser].sheets.length) {
        return null;
    }
    const dates = state.data[currentUser].sheets
        .map(s => s.salaryDate)
        .filter(Boolean)
        .sort();
    return dates[dates.length - 1] || null;
}

// --- MODALE AVVISO DATA DUPLICATA ---
function showDuplicateWarning(onConfirm) {
    pendingDuplicateAction = onConfirm;
    const modal = document.getElementById("modal-duplicate-date");
    if (modal) modal.classList.remove("hidden");
}

function cancelDuplicateDateWarning() {
    pendingDuplicateAction = null;
    const modal = document.getElementById("modal-duplicate-date");
    if (modal) modal.classList.add("hidden");
}

function proceedDuplicateDateWarning() {
    const action = pendingDuplicateAction;
    cancelDuplicateDateWarning();
    if (typeof action === "function") {
        action();
    }
}

// --- CARICAMENTO E SALVATAGGIO CLOUD (SUPABASE + LOCALSTORAGE) ---
async function initApp() {
    lockDateInputsToToday();

    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            if (parsed.users && parsed.data) {
                state = parsed;
            } else if (parsed.Martina || parsed.Marika) {
                state = {
                    users: Object.keys(parsed),
                    data: parsed
                };
            }
        } catch (e) {
            console.error("Errore lettura dati locali:", e);
        }
    }
    showView("auth");

    if (supabaseClient) {
        try {
            const { data, error } = await supabaseClient
                .from('app_data')
                .select('content')
                .eq('id', 'main_state')
                .maybeSingle();

            if (data && data.content && data.content.users && data.content.data) {
                state = data.content;
                localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
                if (currentUser) {
                    if (currentSheetId) renderSheetDetail();
                    else renderDashboard();
                } else {
                    renderAuthUsers();
                }
            } else if (!data) {
                await supabaseClient
                    .from('app_data')
                    .upsert({ id: 'main_state', content: state, updated_at: new Date() });
            }
        } catch (err) {
            console.warn("Impossibile contattare Supabase:", err);
        }
    }
}

async function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

    if (supabaseClient) {
        try {
            await supabaseClient
                .from('app_data')
                .upsert({
                    id: 'main_state',
                    content: state,
                    updated_at: new Date()
                });
        } catch (err) {
            console.error("Errore sincronizzazione Supabase:", err);
        }
    }
}

function isValidName(name) {
    const regex = /^[A-Za-zÀ-ÿ]+(?: [A-Za-zÀ-ÿ]+)*$/;
    return regex.test(name.trim());
}

function isValidPin(pin) {
    return /^[0-9]{4}$/.test(pin.trim());
}

// --- GESTIONE VISTE (ROUTING) ---
function showView(viewName) {
    document.getElementById("view-auth").classList.add("hidden");
    document.getElementById("view-pin").classList.add("hidden");
    document.getElementById("view-dashboard").classList.add("hidden");
    document.getElementById("view-sheet-detail").classList.add("hidden");

    if (viewName === "auth") {
        currentUser = null;
        currentSheetId = null;
        document.getElementById("view-auth").classList.remove("hidden");
        renderAuthUsers();
    } else if (viewName === "pin") {
        document.getElementById("view-pin").classList.remove("hidden");
        resetPinDisplay();
    } else if (viewName === "dashboard") {
        document.getElementById("view-dashboard").classList.remove("hidden");
        renderDashboard();
    } else if (viewName === "sheet-detail") {
        document.getElementById("view-sheet-detail").classList.remove("hidden");
        renderSheetDetail();
    }
}

// --- RENDERING GRIGLIA UTENTI ---
function renderAuthUsers() {
    const grid = document.getElementById("auth-users-grid");
    grid.innerHTML = "";

    state.users.forEach(userName => {
        const initial = userName.trim().charAt(0).toUpperCase() || "U";
        const card = document.createElement("div");
        card.className = "p-4 rounded-2xl border-2 border-gray-100 hover:border-emerald-500 bg-gray-50 hover:bg-emerald-50/40 text-center transition-all group relative flex flex-col justify-between";

        card.innerHTML = `
      <!-- Matita Profilo: in alto a sinistra -->
      <button onclick="editUserProfile('${userName}', event)" class="absolute top-2.5 left-2.5 p-1 text-gray-400 hover:text-blue-600 active:scale-95 transition rounded z-10" title="Modifica nome o PIN">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:block;">
          <path d="M12 20h9"></path>
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
        </svg>
      </button>

      <!-- Cestino Profilo: in alto a destra -->
      <button onclick="deleteUser('${userName}', event)" class="absolute top-2.5 right-2.5 p-1 text-gray-400 hover:text-red-600 active:scale-95 transition rounded z-10" title="Elimina profilo">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:block;">
          <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
        </svg>
      </button>

      <div onclick="requestPinAuth('${userName}')" class="cursor-pointer pt-3">
        <div class="w-12 h-12 bg-white rounded-full flex items-center justify-center mx-auto mb-2 shadow-xs group-hover:scale-105 transition-transform text-emerald-600 font-bold text-lg">
          ${initial}
        </div>
        <span class="text-sm font-semibold text-gray-800 truncate block">${userName}</span>
      </div>
    `;
        grid.appendChild(card);
    });

    const addCard = document.createElement("div");
    addCard.className = "p-4 min-h-[110px] rounded-2xl border-2 border-dashed border-gray-200 hover:border-emerald-400 bg-white hover:bg-gray-50 text-center transition-all cursor-pointer flex flex-col items-center justify-center group";
    addCard.onclick = promptAddNewUser;
    addCard.innerHTML = `
    <div class="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mb-2 group-hover:bg-emerald-600 group-hover:text-white transition-all shadow-xs">
      <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
    </div>
    <span class="text-xs font-semibold text-gray-600 group-hover:text-emerald-700">Aggiungi</span>
  `;
    grid.appendChild(addCard);
}

function promptAddNewUser() {
    const name = prompt("Inserisci il nome del nuovo profilo (solo lettere):");
    if (!name) return;

    const trimmed = name.trim();
    if (!isValidName(trimmed)) {
        alert("Errore: il nome deve contenere solo lettere, senza numeri o caratteri speciali.");
        return;
    }

    if (state.users.some(u => u.toLowerCase() === trimmed.toLowerCase())) {
        alert("Questo profilo esiste già!");
        return;
    }

    const pin = prompt(`Imposta un PIN di 4 cifre per ${trimmed}:`);
    if (!pin || !isValidPin(pin)) {
        alert("Errore: il PIN deve essere composto esattamente da 4 numeri (es. 1234).");
        return;
    }

    state.users.push(trimmed);
    state.data[trimmed] = { pin: pin.trim(), sheets: [] };

    saveState();
    renderAuthUsers();
}

function editUserProfile(userName, event) {
    event.stopPropagation();
    const userData = state.data[userName] || {};

    if (userData.pin) {
        const checkPin = prompt(`Inserisci il PIN attuale di ${userName} per procedere:`);
        if (checkPin !== userData.pin) {
            alert("PIN errato! Impossibile modificare il profilo.");
            return;
        }
    }

    const scelta = prompt(`Profilo "${userName}":\nDigita 1 per modificare il NOME\nDigita 2 per cambiare il PIN`, "1");

    if (scelta === "1") {
        const newName = prompt(`Nuovo nome per "${userName}" (solo lettere):`, userName);
        if (!newName) return;
        const trimmed = newName.trim();
        if (trimmed === userName) return;
        if (!isValidName(trimmed)) {
            alert("Errore: solo lettere ammesse.");
            return;
        }
        if (state.users.some(u => u.toLowerCase() === trimmed.toLowerCase())) {
            alert("Nome già in uso.");
            return;
        }
        const idx = state.users.indexOf(userName);
        if (idx !== -1) state.users[idx] = trimmed;
        state.data[trimmed] = state.data[userName];
        delete state.data[userName];
        saveState();
        renderAuthUsers();
    } else if (scelta === "2") {
        const newPin = prompt("Inserisci il nuovo PIN a 4 cifre:");
        if (!newPin || !isValidPin(newPin)) {
            alert("Errore: il PIN deve essere esattamente di 4 numeri.");
            return;
        }
        state.data[userName].pin = newPin.trim();
        saveState();
        alert("PIN aggiornato con successo!");
    }
}

function deleteUser(userName, event) {
    event.stopPropagation();
    if (state.users.length <= 1) {
        alert("Non puoi eliminare l'unico profilo rimasto!");
        return;
    }

    const userData = state.data[userName] || {};
    if (userData.pin) {
        const checkPin = prompt(`Inserisci il PIN di ${userName} per confermare l'eliminazione:`);
        if (checkPin !== userData.pin) {
            alert("PIN errato. Eliminazione annullata.");
            return;
        }
    } else {
        if (!confirm(`Sei sicura di voler eliminare il profilo "${userName}"?`)) return;
    }

    state.users = state.users.filter(u => u !== userName);
    delete state.data[userName];
    saveState();
    renderAuthUsers();
}

// --- LOGICA AUTENTICAZIONE CON PIN ---
function requestPinAuth(userName) {
    pendingUserForPin = userName;
    const userData = state.data[userName] || {};

    if (!userData.pin) {
        const initialPin = prompt(`Benvenuta ${userName}! Imposta un PIN a 4 cifre per proteggere i tuoi fogli:`);
        if (!initialPin || !isValidPin(initialPin)) {
            alert("PIN non valido. Accesso annullato.");
            return;
        }
        userData.pin = initialPin.trim();
        saveState();
    }

    document.getElementById("pin-user-title").textContent = `Accesso ${userName}`;
    document.getElementById("pin-user-avatar").textContent = userName.trim().charAt(0).toUpperCase();
    showView("pin");
}

function resetPinDisplay() {
    enteredPin = "";
    document.getElementById("pin-error-msg").classList.add("hidden");
    updatePinDots();
}

function updatePinDots() {
    for (let i = 0; i < 4; i++) {
        const dot = document.getElementById(`pin-dot-${i}`);
        if (i < enteredPin.length) {
            dot.className = "w-3.5 h-3.5 rounded-full bg-emerald-600 border-2 border-emerald-600 scale-110 transition-all";
        } else {
            dot.className = "w-3.5 h-3.5 rounded-full border-2 border-gray-300 transition-all";
        }
    }
}

function pressPinDigit(digit) {
    if (enteredPin.length >= 4) return;
    enteredPin += digit;
    updatePinDots();

    if (enteredPin.length === 4) {
        setTimeout(verifyPin, 150);
    }
}

function deletePinDigit() {
    if (enteredPin.length > 0) {
        enteredPin = enteredPin.slice(0, -1);
        updatePinDots();
        document.getElementById("pin-error-msg").classList.add("hidden");
    }
}

function cancelPinAuth() {
    pendingUserForPin = null;
    enteredPin = "";
    showView("auth");
}

function verifyPin() {
    const userData = state.data[pendingUserForPin] || {};
    if (enteredPin === userData.pin) {
        currentUser = pendingUserForPin;
        pendingUserForPin = null;
        enteredPin = "";
        showView("dashboard");
    } else {
        document.getElementById("pin-error-msg").classList.remove("hidden");
        enteredPin = "";
        updatePinDots();
    }
}

function logoutToAuth() {
    showView("auth");
}

function backToDashboard() {
    currentSheetId = null;
    showView("dashboard");
}

// --- DASHBOARD FOGLI ---
function renderDashboard() {
    document.getElementById("dash-user-name").textContent = currentUser;
    const sheets = (state.data[currentUser] && state.data[currentUser].sheets) ? state.data[currentUser].sheets : [];
    document.getElementById("dash-sheet-count").textContent = `${sheets.length} ${sheets.length === 1 ? 'foglio' : 'fogli'}`;

    const container = document.getElementById("dash-sheets-list");
    container.innerHTML = "";

    if (sheets.length === 0) {
        container.innerHTML = `
      <div class="bg-white rounded-2xl p-8 text-center border border-dashed border-gray-200">
        <p class="text-xs text-gray-500">Non hai ancora nessun foglio creato per questo profilo.</p>
        <button onclick="openNewSheetModal()" class="mt-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-4 py-2 rounded-xl transition shadow-sm">
          Crea il tuo primo foglio
        </button>
      </div>
    `;
        return;
    }

    sheets.forEach(sheet => {
        let totalExpenses = 0;
        (sheet.categories || []).forEach(c => {
            totalExpenses += c.items.reduce((acc, curr) => acc + (Number(curr.value) || 0), 0);
        });
        const income = Number(sheet.income) || 0;
        const netSavings = income - totalExpenses;

        const card = document.createElement("div");
        card.className = "bg-white rounded-2xl p-4 shadow-xs border border-gray-100 flex items-center justify-between gap-2 hover:border-emerald-300 transition group";
        card.innerHTML = `
      <div class="space-y-1.5 min-w-0 flex-1">
        <div>
          <div class="text-sm font-bold text-gray-800 truncate leading-tight" title="${sheet.name}">
            ${sheet.name}
          </div>
          <div class="mt-1">
            <span class="inline-block text-[11px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-md font-medium whitespace-nowrap">
              Accredito: ${sheet.salaryDate}
            </span>
          </div>
        </div>

        <div class="text-[9px] text-gray-400 flex items-center gap-2 whitespace-nowrap pt-0.5">
          <span>Stipendio: <strong class="text-gray-600 font-semibold">€${income}</strong></span>
          <span>Spese: <strong class="text-gray-600 font-semibold">€${totalExpenses}</strong></span>
          <span>Risparmio: <strong class="text-emerald-600 font-semibold">€${netSavings}</strong></span>
        </div>
      </div>

      <div class="flex items-center gap-1 shrink-0 self-center">
        <!-- Matita Grigia: solo modifica -->
        <button onclick="openEditSheetModal('${sheet.id}')" class="p-1.5 text-gray-500 hover:text-blue-600 transition active:scale-95 flex items-center justify-center shrink-0" title="Modifica dati foglio">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:block;">
            <path d="M12 20h9"></path>
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
          </svg>
        </button>

        <!-- Tasto Apri -->
        <button onclick="openSheet('${sheet.id}')" class="flex items-center gap-1 text-xs font-bold text-emerald-600 group-hover:text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-xl group-hover:bg-emerald-100/70 transition shrink-0 whitespace-nowrap">
          Apri
          <svg class="w-4 h-4 transform group-hover:translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
        </button>
      </div>
    `;
        container.appendChild(card);
    });
}

// --- CREA NUOVO FOGLIO ---
function openNewSheetModal() {
    const today = getTodayDateString();
    const dateInput = document.getElementById("modal-sheet-date");

    let minDate = null;
    try {
        minDate = getLatestSheetDate();
    } catch(e) { minDate = null; }

    if (dateInput) {
        dateInput.setAttribute('max', today);
        dateInput.max = today;
        
        if (minDate) {
            dateInput.setAttribute('min', minDate);
            dateInput.min = minDate;
        } else {
            dateInput.removeAttribute('min');
        }
        dateInput.value = today;

        // Correzione automatica immediata se l'utente seleziona una data non ammessa su iOS
        dateInput.onchange = function() {
            if (this.value > today) this.value = today;
            if (minDate && this.value < minDate) this.value = minDate;
        };
    }

    const modal = document.getElementById("modal-new-sheet");
    if (modal) modal.classList.remove("hidden");
    
    const nameField = document.getElementById("modal-sheet-name");
    const incField = document.getElementById("modal-sheet-income");
    if (nameField) nameField.value = "";
    if (incField) incField.value = "";
}

function closeNewSheetModal() {
    const modal = document.getElementById("modal-new-sheet");
    if (modal) modal.classList.add("hidden");
}

function confirmCreateNewSheet() {
    const nameInput = document.getElementById("modal-sheet-name")?.value.trim();
    const dateInput = document.getElementById("modal-sheet-date")?.value;
    const incomeInput = document.getElementById("modal-sheet-income")?.value.trim();
    const today = getTodayDateString();

    if (!nameInput) { 
        document.getElementById("modal-sheet-name")?.focus(); 
        return; 
    }
    if (!dateInput) return;
    
    // Auto-correzione silenziosa dei limiti data (niente alert con github.io)
    if (dateInput > today) { 
        document.getElementById("modal-sheet-date").value = today;
        return; 
    }

    let minDate = null;
    try { minDate = getLatestSheetDate(); } catch(e) { minDate = null; }

    if (minDate && dateInput < minDate) {
        document.getElementById("modal-sheet-date").value = minDate;
        return; 
    }

    const incomeVal = round2(incomeInput);
    if (!incomeInput || incomeVal <= 0) { 
        document.getElementById("modal-sheet-income")?.focus(); 
        return; 
    }

    const existingSheets = (state.data[currentUser]?.sheets || []);
    const isDuplicate = existingSheets.some(s => s.salaryDate === dateInput);

    const executeCreate = () => {
        if (!currentUser) return;
        if (!state.data[currentUser]) {
            state.data[currentUser] = { pin: null, sheets: [] };
        }

        const initialCategories = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)).map(category => {
            category.items = category.items.map(item => ({ ...item, value: 0 }));
            return category;
        });

        const newSheet = {
            id: "sheet_" + Date.now(),
            name: nameInput,
            salaryDate: dateInput,
            income: incomeVal,
            categories: initialCategories
        };

        closeNewSheetModal();
        state.data[currentUser].sheets.unshift(newSheet);
        currentSheetId = newSheet.id;
        saveState();

        renderDashboard();
        showView("sheet-detail");
        renderSheetDetail();
    };

    if (isDuplicate) {
        showDuplicateWarning(executeCreate);
    } else {
        executeCreate();
    }
}

// --- MODIFICA DATI FOGLIO ---
function openEditSheetModal(sheetId) {
    try {
        const sheets = (state.data[currentUser]?.sheets || []);
        const sheet = sheets.find(s => s.id === sheetId);
        if (!sheet) return;
        editingSheetId = sheetId;

        const modal = document.getElementById("modal-edit-sheet");
        if (modal) modal.classList.remove("hidden");

        const today = getTodayDateString();
        const dateInput = document.getElementById("edit-sheet-date");

        if (dateInput) {
            const otherDates = sheets
                .filter(s => s.id !== sheetId && s.salaryDate)
                .map(s => s.salaryDate)
                .sort();

            const prevDates = otherDates.filter(d => d <= sheet.salaryDate);
            const minDate = prevDates.length > 0 ? prevDates[prevDates.length - 1] : null;

            const nextDates = otherDates.filter(d => d > sheet.salaryDate);
            let maxDate = today;

            if (nextDates.length > 0) {
                maxDate = nextDates[0] < today ? nextDates[0] : today;
            } else {
                maxDate = today;
            }

            if (minDate) {
                dateInput.setAttribute('min', minDate);
                dateInput.min = minDate;
            } else {
                dateInput.removeAttribute('min');
            }

            dateInput.setAttribute('max', maxDate);
            dateInput.max = maxDate;
            dateInput.value = sheet.salaryDate;
        }

        const nameInput = document.getElementById("edit-sheet-name");
        const incomeInput = document.getElementById("edit-sheet-income");
        if (nameInput) nameInput.value = sheet.name || "";
        if (incomeInput) incomeInput.value = sheet.income || "";

    } catch (err) {
        console.error("Errore apertura modale modifica:", err);
    }
}

function closeEditSheetModal() {
    const modal = document.getElementById("modal-edit-sheet");
    if (modal) modal.classList.add("hidden");
    editingSheetId = null;
}

function confirmEditSheet() {
    if (!editingSheetId || !currentUser) return;
    const sheet = (state.data[currentUser]?.sheets || []).find(s => s.id === editingSheetId);
    if (!sheet) return;

    const nameInput = document.getElementById("edit-sheet-name")?.value.trim();
    const dateInput = document.getElementById("edit-sheet-date")?.value;
    const incomeInput = document.getElementById("edit-sheet-income")?.value.trim();
    const today = getTodayDateString();

    if (!nameInput) { alert("Inserisci il nome del foglio."); return; }
    if (!dateInput) { alert("Seleziona la data."); return; }

    const inputMin = document.getElementById("edit-sheet-date")?.getAttribute("min");
    const inputMax = document.getElementById("edit-sheet-date")?.getAttribute("max") || today;

    if (dateInput > inputMax) {
        alert(`La data non può superare il limite consentito (${inputMax}).`);
        return;
    }
    if (inputMin && dateInput < inputMin) {
        alert(`La data non può essere antecedente al foglio precedente (${inputMin}).`);
        return;
    }

    const incomeVal = round2(incomeInput);
    if (!incomeInput || incomeVal <= 0) {
        alert("Inserisci uno stipendio valido.");
        return;
    }

    const otherSheets = (state.data[currentUser]?.sheets || []).filter(s => s.id !== editingSheetId);
    const isDuplicate = otherSheets.some(s => s.salaryDate === dateInput);

    const executeEdit = () => {
        sheet.name = nameInput;
        sheet.salaryDate = dateInput;
        sheet.income = incomeVal;

        saveState();
        closeEditSheetModal();
        renderDashboard();

        if (currentSheetId === sheet.id) {
            renderSheetDetail();
        }
    };

    if (isDuplicate) {
        showDuplicateWarning(executeEdit);
    } else {
        executeEdit();
    }
}

function openSheet(sheetId) {
    currentSheetId = sheetId;
    showView("sheet-detail");
}

function getActiveSheet() {
    if (!currentUser || !currentSheetId) return null;
    return state.data[currentUser].sheets.find(s => s.id === currentSheetId) || null;
}

function renderSheetDetail() {
    const activeSheet = getActiveSheet();
    if (!activeSheet) { backToDashboard(); return; }

    document.getElementById("current-sheet-title").textContent = activeSheet.name;
    document.getElementById("current-sheet-date").textContent = activeSheet.salaryDate;
    document.getElementById("input-income").value = activeSheet.income || "";

    let totalExpenses = 0;
    const catTotals = {};

    activeSheet.categories.forEach(cat => {
        const sum = cat.items.reduce((acc, curr) => acc + (Number(curr.value) || 0), 0);
        catTotals[cat.key] = round2(sum);
        totalExpenses += sum;
    });

    totalExpenses = round2(totalExpenses);
    const income = round2(activeSheet.income);
    const netSavings = round2(income - totalExpenses);
    const savingsRatio = income > 0 ? Math.round((netSavings / income) * 100) : 0;

    document.getElementById("stat-total-expenses").textContent = `€${formatCurrency(totalExpenses)}`;
    document.getElementById("stat-net-savings").textContent = `€${formatCurrency(netSavings)}`;
    document.getElementById("stat-savings-ratio").textContent = `${savingsRatio}%`;

    const pctRicorrenti = totalExpenses > 0 ? ((catTotals["ricorrenti_base"] || 0) / totalExpenses) * 100 : 0;
    const pctSpot = totalExpenses > 0 ? ((catTotals["uscite_spot"] || 0) / totalExpenses) * 100 : 0;
    const pctVariabili = totalExpenses > 0 ? ((catTotals["spese_variabili"] || 0) / totalExpenses) * 100 : 0;

    document.getElementById("bar-segment-ricorrenti").style.width = `${pctRicorrenti}%`;
    document.getElementById("bar-segment-spot").style.width = `${pctSpot}%`;
    document.getElementById("bar-segment-variabili").style.width = `${pctVariabili}%`;

    renderCategories(activeSheet, totalExpenses);
}

function renderCategories(activeSheet, totalExpenses) {
    const container = document.getElementById("categories-container");
    container.innerHTML = "";

    activeSheet.categories.forEach((cat, catIndex) => {
        const catSum = cat.items.reduce((acc, curr) => acc + (Number(curr.value) || 0), 0);
        const catPct = totalExpenses > 0 ? Math.round((catSum / totalExpenses) * 100) : 0;

        const catDiv = document.createElement("div");
        catDiv.className = "border-t border-gray-100 pt-4";
        catDiv.innerHTML = `
      <div class="flex items-center justify-between cursor-pointer mb-3 select-none" onclick="toggleCategoryCollapse(${catIndex})">
        <div class="flex items-center gap-2">
          <span class="w-2.5 h-2.5 rounded-full ${cat.badgeClass}"></span>
          <span class="text-sm font-semibold text-gray-800">${cat.title}</span>
        </div>
        <div class="flex items-center gap-3 text-xs sm:text-sm">
          <span class="text-gray-500 font-medium">${catPct}%</span>
          <span class="font-bold text-gray-800">€${catSum}</span>
          <svg class="w-4 h-4 text-gray-500 transform transition-transform ${cat.collapsed ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
          </svg>
        </div>
      </div>
      
      <div id="cat-body-${catIndex}" class="space-y-4 ${cat.collapsed ? 'hidden' : ''}">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 pt-1" id="cat-items-${catIndex}">
        </div>

        <button onclick="promptAddNewItem(${catIndex})" class="mt-2 text-xs font-semibold text-emerald-600 hover:text-emerald-700 flex items-center gap-1">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
          Aggiungi voce a questa sezione
        </button>
      </div>
    `;

        container.appendChild(catDiv);

        const itemsContainer = catDiv.querySelector(`#cat-items-${catIndex}`);
        cat.items.forEach((item, itemIndex) => {
            const rawVal = Number(item.value) || 0;
            const maxVal = Math.max(item.max || 300, rawVal * 1.5, 100);
            const displayVal = rawVal > 0 ? rawVal : "";

            const row = document.createElement("div");
            row.className = "space-y-1.5";
            row.innerHTML = `
        <div class="flex items-center justify-between text-xs text-gray-700">
          <span class="truncate max-w-[180px] font-medium" title="${item.name}">${item.name}</span>
          
          <div class="flex items-center gap-0.5">
            <button onclick="renameItem(${catIndex}, ${itemIndex})" class="p-1 text-blue-600 hover:text-blue-800 transition active:scale-95 flex items-center justify-center" title="Modifica nome">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:block;">
                <path d="M12 20h9"></path>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
              </svg>
            </button>

            <button onclick="deleteItem(${catIndex}, ${itemIndex})" class="p-1 text-red-500 hover:text-red-700 transition active:scale-95 flex items-center justify-center" title="Elimina voce">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:block;">
                <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
              </svg>
            </button>
          </div>
        </div>

        <div class="flex items-center gap-3">
          <input 
            type="range" min="0" max="${maxVal}" step="1" value="${rawVal}" 
            tabindex="-1"
            class="custom-slider pointer-events-none select-none opacity-85"
          >
          
          <div class="flex items-center h-[42px] bg-[#f1f3f4] rounded-xl px-3 py-2.5 min-w-[95px] max-w-[120px] justify-between border border-transparent focus-within:border-emerald-500 focus-within:bg-white transition-all shadow-2xs">
            <span class="text-xs text-gray-400 font-semibold mr-1 select-none">€</span>
            <input 
              type="number" 
              step="any"
              inputmode="decimal"
              placeholder="0"
              value="${displayVal}" 
              onfocus="this.select()"
              onchange="updateItemValue(${catIndex}, ${itemIndex}, this.value)" 
              class="w-full bg-transparent text-right text-sm font-bold text-gray-800 focus:outline-none placeholder:text-gray-400 placeholder:font-normal leading-normal"
            >
          </div>
        </div>
      `;
            itemsContainer.appendChild(row);
        });
    });
}

function handleIncomeChange(val) {
    const activeSheet = getActiveSheet();
    if (!activeSheet) return;
    activeSheet.income = round2(val);
    saveState();
    renderSheetDetail();
}

function updateItemValue(catIndex, itemIndex, val) {
    const activeSheet = getActiveSheet();
    if (!activeSheet) return;
    activeSheet.categories[catIndex].items[itemIndex].value = round2(val);
    saveState();
    renderSheetDetail();
}

let pendingActionItem = null;

// --- MODIFICA NOME VOCE ---
function renameItem(catIndex, itemIndex) {
    const activeSheet = getActiveSheet();
    if (!activeSheet) return;
    const item = activeSheet.categories[catIndex]?.items[itemIndex];
    if (!item) return;

    pendingActionItem = { catIndex, itemIndex };
    const input = document.getElementById("input-rename-item");
    if (input) input.value = item.name;

    const modal = document.getElementById("modal-rename-item");
    if (modal) modal.classList.remove("hidden");
}

function closeRenameModal() {
    pendingActionItem = null;
    const modal = document.getElementById("modal-rename-item");
    if (modal) modal.classList.add("hidden");
}

function confirmRenameItem() {
    if (!pendingActionItem) return;
    const { catIndex, itemIndex } = pendingActionItem;
    const activeSheet = getActiveSheet();
    if (!activeSheet) { closeRenameModal(); return; }

    const input = document.getElementById("input-rename-item");
    const newName = input ? input.value.trim() : "";
    if (newName) {
        activeSheet.categories[catIndex].items[itemIndex].name = newName;
        saveState();
        renderSheetDetail();
    }
    closeRenameModal();
}

function promptAddNewItem(catIndex) {
    const name = prompt("Nome della nuova voce (es. Bolletta luce, Taxi, Cena):");
    if (!name || !name.trim()) return;

    const activeSheet = getActiveSheet();
    if (!activeSheet) return;

    activeSheet.categories[catIndex].items.push({
        id: "item_" + Date.now(), name: name.trim(), value: 0, max: 200
    });
    saveState();
    renderSheetDetail();
}

// --- ELIMINA VOCE ---
function deleteItem(catIndex, itemIndex) {
    const activeSheet = getActiveSheet();
    if (!activeSheet) return;
    const item = activeSheet.categories[catIndex]?.items[itemIndex];
    if (!item) return;

    pendingActionItem = { catIndex, itemIndex };
    const label = document.getElementById("delete-item-label");
    if (label) label.textContent = `(${item.name})`;

    const modal = document.getElementById("modal-delete-item");
    if (modal) modal.classList.remove("hidden");
}

function closeDeleteItemModal() {
    pendingActionItem = null;
    const modal = document.getElementById("modal-delete-item");
    if (modal) modal.classList.add("hidden");
}

function confirmExecuteDeleteItem() {
    if (!pendingActionItem) return;
    const { catIndex, itemIndex } = pendingActionItem;
    const activeSheet = getActiveSheet();
    if (!activeSheet) { closeDeleteItemModal(); return; }

    activeSheet.categories[catIndex].items.splice(itemIndex, 1);
    saveState();
    closeDeleteItemModal();
    renderSheetDetail();
}

function toggleCategoryCollapse(catIndex) {
    const activeSheet = getActiveSheet();
    if (!activeSheet) return;
    activeSheet.categories[catIndex].collapsed = !activeSheet.categories[catIndex].collapsed;
    renderSheetDetail();
}

function deleteCurrentSheet() {
    const modal = document.getElementById("modal-delete-sheet");
    if (modal) {
        modal.classList.remove("hidden");
    } else {
        executeDeleteCurrentSheet();
    }
}

function closeDeleteSheetModal() {
    const modal = document.getElementById("modal-delete-sheet");
    if (modal) modal.classList.add("hidden");
}

function executeDeleteCurrentSheet() {
    const activeSheet = getActiveSheet();
    if (!activeSheet) {
        closeDeleteSheetModal();
        return;
    }

    state.data[currentUser].sheets = state.data[currentUser].sheets.filter(s => s.id !== activeSheet.id);
    saveState();

    closeDeleteSheetModal();
    backToDashboard();
}

function exportToExcel() {
    const activeSheet = getActiveSheet();
    if (!activeSheet) return;

    const rows = [];
    rows.push(["PROFILO", currentUser]);
    rows.push(["FOGLIO", activeSheet.name]);
    rows.push(["DATA ACCREDITO", activeSheet.salaryDate]);
    rows.push(["STIPENDIO / ENTRATA (€)", activeSheet.income]);
    rows.push([]);
    rows.push(["SEZIONE", "VOCE DI SPESA", "IMPORTO (€)"]);

    let total = 0;
    activeSheet.categories.forEach(cat => {
        cat.items.forEach(item => {
            rows.push([cat.title, item.name, Number(item.value) || 0]);
            total += Number(item.value) || 0;
        });
    });

    rows.push([]);
    rows.push(["TOTALE SPESE (€)", "", total]);
    rows.push(["RISPARMIO NETTO (€)", "", (Number(activeSheet.income) || 0) - total]);

    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Budget Mese");

    const fileName = `saveMoney_${currentUser}_${activeSheet.name.replace(/\s+/g, "_")}.xlsx`;
    XLSX.writeFile(workbook, fileName);
}

document.addEventListener("DOMContentLoaded", initApp);