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
            // Blocca la digitazione manuale da tastiera: obbliga a usare il picker calendario
            input.addEventListener('keydown', (e) => e.preventDefault());
        }
    });
}

// --- CARICAMENTO E SALVATAGGIO CLOUD (SUPABASE + LOCALSTORAGE) ---
async function initApp() {
    // 1. Blocca subito i limiti del calendario alla data di oggi
    lockDateInputsToToday();

    // 2. Carica subito i dati locali se presenti (nessun ritardo grafico)
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

    // 3. Scarica i dati aggiornati da Supabase
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
      <div class="absolute top-2 right-2 flex items-center gap-1 z-10">
        <button onclick="editUserProfile('${userName}', event)" class="p-1 text-gray-400 hover:text-blue-600 rounded transition" title="Modifica nome o PIN">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path>
          </svg>
        </button>
        <button onclick="deleteUser('${userName}', event)" class="p-1 text-gray-400 hover:text-red-600 rounded transition" title="Elimina profilo">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
          </svg>
        </button>
      </div>

      <div onclick="requestPinAuth('${userName}')" class="cursor-pointer pt-2">
        <div class="w-12 h-12 bg-white rounded-full flex items-center justify-center mx-auto mb-2 shadow-xs group-hover:scale-105 transition-transform text-emerald-600 font-bold text-lg">
          ${initial}
        </div>
        <span class="text-sm font-semibold text-gray-800 truncate block">${userName}</span>
      </div>
    `;
        grid.appendChild(card);
    });

    // Card per aggiungere nuovo utente
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

// Creazione utente con nome e PIN a 4 cifre
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

// Modifica profilo: scelta tra rinominare e cambiare PIN
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
    const sheets = state.data[currentUser]?.sheets || [];
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
        card.className = "bg-white rounded-2xl p-4 shadow-xs border border-gray-100 flex items-center justify-between hover:border-emerald-300 transition group";
        card.innerHTML = `
      <div class="space-y-1">
        <div class="flex items-center gap-2">
          <span class="text-sm font-bold text-gray-800">${sheet.name}</span>
          <span class="text-[11px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-md font-medium">
            Accredito: ${sheet.salaryDate}
          </span>
        </div>
        <div class="text-xs text-gray-500 flex items-center gap-3">
          <span>Stipendio: <strong class="text-gray-700">€${income}</strong></span>
          <span>Spese: <strong class="text-gray-700">€${totalExpenses}</strong></span>
          <span>Risparmio: <strong class="text-emerald-600">€${netSavings}</strong></span>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <button onclick="openEditSheetModal('${sheet.id}')" class="text-gray-400 hover:text-blue-600 transition p-1.5 rounded-lg hover:bg-blue-50" title="Modifica dati foglio">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path>
          </svg>
        </button>

        <button onclick="openSheet('${sheet.id}')" class="flex items-center gap-1 text-xs font-bold text-emerald-600 group-hover:text-emerald-700 bg-emerald-50 px-3.5 py-2 rounded-xl group-hover:bg-emerald-100/70 transition">
          Apri
          <svg class="w-4 h-4 transform group-hover:translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
        </button>
      </div>
    `;
        container.appendChild(card);
    });
}

function openNewSheetModal() {
    const today = getTodayDateString();
    const dateInput = document.getElementById("modal-sheet-date");
    if (dateInput) {
        dateInput.setAttribute('max', today);
        dateInput.max = today;
        dateInput.value = today;
    }

    document.getElementById("modal-new-sheet").classList.remove("hidden");
    document.getElementById("modal-sheet-name").value = "";
    document.getElementById("modal-sheet-income").value = "";
}

function closeNewSheetModal() {
    document.getElementById("modal-new-sheet").classList.add("hidden");
}

function confirmCreateNewSheet() {
    const nameInput = document.getElementById("modal-sheet-name").value.trim();
    const dateInput = document.getElementById("modal-sheet-date").value;
    const incomeInput = document.getElementById("modal-sheet-income").value.trim();
    const today = getTodayDateString();

    if (!nameInput) { alert("Inserisci il nome del foglio."); return; }
    if (!dateInput) { alert("Seleziona la data."); return; }
    if (dateInput > today) {
        alert("Non puoi selezionare una data futura per l'accredito.");
        return;
    }
    if (!incomeInput || Number(incomeInput) <= 0) { alert("Inserisci lo stipendio."); return; }

    const initialCategories = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)).map(category => {
        category.items = category.items.map(item => ({ ...item, value: 0 }));
        return category;
    });

    const newSheet = {
        id: "sheet_" + Date.now(),
        name: nameInput,
        salaryDate: dateInput,
        income: Number(incomeInput),
        categories: initialCategories
    };

    state.data[currentUser].sheets.unshift(newSheet);
    currentSheetId = newSheet.id;
    saveState();
    closeNewSheetModal();
    showView("sheet-detail");
}

function openEditSheetModal(sheetId) {
    const sheet = state.data[currentUser].sheets.find(s => s.id === sheetId);
    if (!sheet) return;

    editingSheetId = sheetId;

    const today = getTodayDateString();
    const dateInput = document.getElementById("edit-sheet-date");
    if (dateInput) {
        dateInput.setAttribute('max', today);
        dateInput.max = today;
        dateInput.value = sheet.salaryDate;
    }

    document.getElementById("modal-edit-sheet").classList.remove("hidden");
    document.getElementById("edit-sheet-name").value = sheet.name;
    document.getElementById("edit-sheet-income").value = sheet.income;
}

function closeEditSheetModal() {
    document.getElementById("modal-edit-sheet").classList.add("hidden");
    editingSheetId = null;
}

function confirmEditSheet() {
    const nameInput = document.getElementById("edit-sheet-name").value.trim();
    const dateInput = document.getElementById("edit-sheet-date").value;
    const today = getTodayDateString();

    if (!nameInput) { alert("Inserisci il nome del foglio."); return; }
    if (!dateInput) { alert("Seleziona la data."); return; }
    if (dateInput > today) {
        alert("Non puoi selezionare una data futura per l'accredito.");
        return;
    }
    const incomeInput = document.getElementById("edit-sheet-income").value.trim();
    if (!incomeInput || Number(incomeInput) <= 0) { alert("Inserisci lo stipendio."); return; }

    const sheet = state.data[currentUser].sheets.find(s => s.id === editingSheetId);
    if (sheet) {
        sheet.name = nameInput;
        sheet.salaryDate = dateInput;
        sheet.income = Number(incomeInput);
        saveState();
        renderDashboard();
    }
    closeEditSheetModal();
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
    document.getElementById("input-income").value = activeSheet.income || 0;

    let totalExpenses = 0;
    const catTotals = {};

    activeSheet.categories.forEach(cat => {
        const sum = cat.items.reduce((acc, curr) => acc + (Number(curr.value) || 0), 0);
        catTotals[cat.key] = sum;
        totalExpenses += sum;
    });

    const income = Number(activeSheet.income) || 0;
    const netSavings = income - totalExpenses;
    const savingsRatio = income > 0 ? Math.round((netSavings / income) * 100) : 0;

    document.getElementById("stat-total-expenses").textContent = `€${totalExpenses}`;
    document.getElementById("stat-net-savings").textContent = `€${netSavings}`;
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
            const maxVal = Math.max(item.max || 300, (Number(item.value) || 0) * 1.5, 100);
            const row = document.createElement("div");
            row.className = "space-y-1.5";
            row.innerHTML = `
        <div class="flex items-center justify-between text-xs text-gray-700">
          <span class="truncate max-w-[180px] font-medium" title="${item.name}">${item.name}</span>
          
          <div class="flex items-center gap-2">
            <button onclick="renameItem(${catIndex}, ${itemIndex})" class="text-gray-400 hover:text-blue-600 transition p-0.5 rounded" title="Modifica nome">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path>
              </svg>
            </button>
            <button onclick="deleteItem(${catIndex}, ${itemIndex})" class="text-gray-400 hover:text-red-600 transition p-0.5 rounded" title="Elimina voce">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
              </svg>
            </button>
          </div>
        </div>

        <div class="flex items-center gap-3">
          <input 
            type="range" min="0" max="${maxVal}" step="5" value="${item.value || 0}" 
            oninput="updateItemValue(${catIndex}, ${itemIndex}, this.value)" class="custom-slider"
          >
          <div class="flex items-center bg-[#f1f3f4] rounded-lg px-2.5 py-1 min-w-[75px] max-w-[95px] justify-between">
            <span class="text-xs text-gray-500 mr-1">€</span>
            <input type="number" value="${item.value || 0}" onchange="updateItemValue(${catIndex}, ${itemIndex}, this.value)" class="w-full bg-transparent text-right text-xs sm:text-sm font-semibold text-gray-800 focus:outline-none">
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
    activeSheet.income = Number(val) || 0;
    saveState();
    renderSheetDetail();
}

function updateItemValue(catIndex, itemIndex, val) {
    const activeSheet = getActiveSheet();
    if (!activeSheet) return;
    activeSheet.categories[catIndex].items[itemIndex].value = Number(val) || 0;
    saveState();
    renderSheetDetail();
}

function renameItem(catIndex, itemIndex) {
    const activeSheet = getActiveSheet();
    if (!activeSheet) return;
    const currentName = activeSheet.categories[catIndex].items[itemIndex].name;
    const newName = prompt("Modifica il nome della voce:", currentName);
    if (newName && newName.trim()) {
        activeSheet.categories[catIndex].items[itemIndex].name = newName.trim();
        saveState();
        renderSheetDetail();
    }
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

function deleteItem(catIndex, itemIndex) {
    const activeSheet = getActiveSheet();
    if (!activeSheet) return;
    activeSheet.categories[catIndex].items.splice(itemIndex, 1);
    saveState();
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