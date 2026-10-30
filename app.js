// --- CONFIGURAZIONE SUPABASE ---
const SUPABASE_URL = "https://qsankatsfbunrqnejeeg.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_zj0gQGLvNmNOMrDdAgwqsQ_PhZAb4nD";

let supabaseClient = null;
if (window.supabase) {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// --- STATO GLOBALE DELL'APPLICAZIONE ---
let currentAccountId = null;
let currentAccountName = null;
let currentSheetId = null;
let editingSheetId = null;
let viewingPiggyIdtabular = null;

let pendingUserForPin = null;
let enteredPin = "";
let pendingDuplicateAction = null;
let pendingActionItem = null;
let pendingLockSheetId = null;
let rendicontoChartInstance = null;

let fpCreateInstance = null;
let fpEditInstance = null;
let fpCalendarInstance = null;

let appAccounts = [];
let appSheets = [];
let appPiggyBanks = [];

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

// --- HELPER DATE & FORMATTAZIONE ---
function getTodayDateString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function round2(num) {
    const val = Number(num) || 0;
    return Math.round((val + Number.EPSILON) * 100) / 100;
}

function formatCurrency(num) {
    const val = round2(num);
    return val % 1 === 0 ? val.toString() : val.toFixed(2);
}

function getLatestSheetDate() {
    if (!appSheets.length) return null;
    const dates = appSheets
        .map(s => s.salaryDate)
        .filter(Boolean)
        .sort();
    return dates[dates.length - 1] || null;
}

// --- GESTIONE TEMA DARK / LIGHT ---
const THEME_KEY = "savemoney_theme";

function applyTheme(isDark) {
    if (isDark) {
        document.documentElement.classList.add("dark");
        document.body.classList.add("bg-gray-900", "text-gray-100");
        document.body.classList.remove("bg-[#f8f9fa]", "text-gray-800");
    } else {
        document.documentElement.classList.remove("dark");
        document.body.classList.remove("bg-gray-900", "text-gray-100");
        document.body.classList.add("bg-[#f8f9fa]", "text-gray-800");
    }
}

function toggleDarkMode() {
    const isDark = document.documentElement.classList.contains("dark");
    applyTheme(!isDark);
    localStorage.setItem(THEME_KEY, !isDark ? "dark" : "light");
}

function initTheme() {
    const savedTheme = localStorage.getItem(THEME_KEY);
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(savedTheme ? (savedTheme === "dark") : prefersDark);
}

// --- GESTIONE MENU LATERALE (DRAWER) ---
function toggleSidebar() {
    const sidebar = document.getElementById("app-sidebar");
    const panel = document.getElementById("sidebar-panel");
    const overlay = document.getElementById("sidebar-overlay");
    if (!sidebar || !panel || !overlay) return;

    if (sidebar.classList.contains("hidden")) {
        sidebar.classList.remove("hidden");
        setTimeout(() => {
            panel.classList.remove("-translate-x-full");
            overlay.classList.remove("opacity-0");
        }, 10);
    } else {
        panel.classList.add("-translate-x-full");
        overlay.classList.add("opacity-0");
        setTimeout(() => sidebar.classList.add("hidden"), 300);
    }
}

function openCalendarFromSidebar() {
    toggleSidebar();
    if (appSheets.length === 0) {
        alert("Crea prima almeno un foglio spese per accedere al calendario!");
        return;
    }
    if (appSheets.length === 1) {
        currentSheetId = appSheets[0].id;
        showView("calendar");
        return;
    }
    openSelectCalendarSheetModal();
}

function openTrackerFromSidebar() {
    toggleSidebar();
    if (appSheets.length === 0) {
        alert("Crea prima almeno un foglio spese per accedere al tracker!");
        return;
    }
    if (!currentSheetId || !appSheets.some(s => s.id === currentSheetId)) {
        currentSheetId = appSheets[0].id;
    }
    showView("tracker");
}

function openPiggyBankFromSidebar() {
    toggleSidebar();
    const activePiggy = appPiggyBanks.find(p => !p.isCompleted);
    if (activePiggy) {
        viewingPiggyIdtabular = activePiggy.id;
        showView("piggy-bank");
    } else if (appPiggyBanks.length > 0) {
        showView("piggy-list");
    } else {
        openNewPiggyModal();
    }
}

function openSelectCalendarSheetModal() {
    const selectEl = document.getElementById("select-calendar-sheet-id");
    if (!selectEl || appSheets.length === 0) return;
    selectEl.innerHTML = "";
    appSheets.forEach(sheet => {
        const opt = document.createElement("option");
        opt.value = sheet.id;
        opt.textContent = `${sheet.name} (Accredito: ${sheet.salaryDate})`;
        if (sheet.id === currentSheetId) opt.selected = true;
        selectEl.appendChild(opt);
    });
    document.getElementById("modal-select-calendar-sheet")?.classList.remove("hidden");
}

function closeSelectCalendarSheetModal() {
    document.getElementById("modal-select-calendar-sheet")?.classList.add("hidden");
}

function confirmSelectCalendarSheet() {
    const selectEl = document.getElementById("select-calendar-sheet-id");
    if (!selectEl) return;
    currentSheetId = selectEl.value;
    closeSelectCalendarSheetModal();
    showView("calendar");
}

// --- CARICAMENTO E SALVATAGGIO CLOUD (SUPABASE) ---
async function initApp() {
    initTheme();

    if (supabaseClient) {
        try {
            const { data, error } = await supabaseClient
                .from('accounts')
                .select('*');

            if (!error && data) {
                appAccounts = data;
            }
        } catch (err) {
            console.warn("Impossibile contattare Supabase:", err);
        }
    }

    showView("auth");
    renderAuthUsers();
}

async function loadUserSheets(accountId) {
    if (!supabaseClient) return;
    try {
        const { data, error } = await supabaseClient
            .from('sheets')
            .select('*')
            .eq('account_id', accountId)
            .order('salary_date', { ascending: false });

        if (!error && data) {
            appSheets = data.map(s => ({
                id: s.id,
                name: s.name,
                salaryDate: s.salary_date,
                income: Number(s.income),
                categories: s.categories || [],
                dailyExpenses: s.daily_expenses || [],
                extraIncomes: s.extra_incomes || [],
                isLocked: s.is_locked,
                closedDate: s.closed_date
            }));
        } else {
            appSheets = [];
        }

        await loadUserPiggyBanks(accountId);
        if (document.getElementById("view-piggy-bank") && !document.getElementById("view-piggy-bank").classList.contains("hidden")) {
            renderPiggyBankView();
        }

    } catch (err) {
        console.error("Errore caricamento fogli:", err);
        appSheets = [];
    }
}

async function loadUserPiggyBanks(accountId) {
    if (!supabaseClient) return;
    try {
        const { data, error } = await supabaseClient
            .from('piggy_banks')
            .select('*')
            .eq('account_id', accountId)
            .order('created_at', { ascending: false });

        if (!error && data) {
            appPiggyBanks = data.map(p => {
                let hList = [];
                if (p.history) {
                    if (Array.isArray(p.history)) {
                        hList = p.history;
                    } else if (typeof p.history === 'string') {
                        try {
                            hList = JSON.parse(p.history);
                        } catch (e) {
                            hList = [];
                        }
                    }
                }

                return {
                    id: p.id,
                    title: p.title,
                    targetAmount: Number(p.target_amount),
                    currentAmount: Number(p.current_amount || 0),
                    isCompleted: Boolean(p.is_completed),
                    createdAt: p.created_at,
                    closedDate: p.closed_date,
                    history: hList
                };
            });
        } else {
            appPiggyBanks = [];
        }
    } catch (err) {
        console.error("Errore caricamento salvadanai:", err);
        appPiggyBanks = [];
    }
}

async function saveState() {
    if (!supabaseClient || !currentAccountId) return;

    const rowsToUpsert = appSheets.map(s => ({
        id: s.id,
        account_id: currentAccountId,
        name: s.name,
        salary_date: s.salaryDate,
        income: s.income,
        categories: s.categories,
        daily_expenses: s.dailyExpenses || [],
        extra_incomes: s.extraIncomes || [],
        is_locked: Boolean(s.isLocked),
        closed_date: s.closedDate || null,
        updated_at: new Date()
    }));

    if (rowsToUpsert.length > 0) {
        const { error } = await supabaseClient.from('sheets').upsert(rowsToUpsert);
        if (error) console.error("Errore salvataggio su Supabase:", error);
    }
}

async function deleteSheetFromCloud(sheetId) {
    if (!supabaseClient) return;
    await supabaseClient.from('sheets').delete().eq('id', sheetId);
}

// --- GESTIONE VISTE (ROUTING) ---
function showView(viewName) {
    const views = ["view-auth", "view-pin", "view-dashboard", "view-sheet-detail", "view-rendiconto", "view-calendar", "view-tracker", "view-piggy-bank", "view-piggy-list"];
    views.forEach(v => document.getElementById(v)?.classList.add("hidden"));

    if (viewName === "auth") {
        currentAccountId = null;
        currentAccountName = null;
        currentSheetId = null;
        document.getElementById("view-auth")?.classList.remove("hidden");
        renderAuthUsers();
    } else if (viewName === "pin") {
        document.getElementById("view-pin")?.classList.remove("hidden");
        resetPinDisplay();
    } else if (viewName === "dashboard") {
        document.getElementById("view-dashboard")?.classList.remove("hidden");
        renderDashboard();
    } else if (viewName === "sheet-detail") {
        document.getElementById("view-sheet-detail")?.classList.remove("hidden");
        renderSheetDetail();
    } else if (viewName === "rendiconto") {
        document.getElementById("view-rendiconto")?.classList.remove("hidden");
        renderRendicontoView();
    } else if (viewName === "calendar") {
        document.getElementById("view-calendar")?.classList.remove("hidden");
        renderCalendarView();
    } else if (viewName === "tracker") {
        document.getElementById("view-tracker")?.classList.remove("hidden");
        renderTrackerView();
    } else if (viewName === "piggy-bank") {
        document.getElementById("view-piggy-bank")?.classList.remove("hidden");
        renderPiggyBankView();
    } else if (viewName === "piggy-list") {
        document.getElementById("view-piggy-list")?.classList.remove("hidden");
        renderPiggyListView();
    }
}

// --- RENDERING GRIGLIA UTENTI ---
function renderAuthUsers() {
    const grid = document.getElementById("auth-users-grid");
    if (!grid) return;
    grid.innerHTML = "";

    appAccounts.forEach(acc => {
        const userName = acc.name;
        const initial = userName.trim().charAt(0).toUpperCase() || "U";
        const card = document.createElement("div");
        card.className = "p-4 rounded-2xl border-2 border-gray-100 dark:border-gray-700 hover:border-emerald-500 bg-gray-50 dark:bg-gray-700 hover:bg-emerald-50/40 dark:hover:bg-gray-600 text-center transition-all group relative flex flex-col justify-between cursor-pointer";

        card.innerHTML = `
      <div onclick="requestPinAuth('${acc.id}')" class="pt-3">
        <div class="w-12 h-12 bg-white dark:bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-2 shadow-xs group-hover:scale-105 transition-transform text-emerald-600 dark:text-emerald-400 font-bold text-lg">
          ${initial}
        </div>
        <span class="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate block">${userName}</span>
      </div>
    `;
        grid.appendChild(card);
    });

    const addCard = document.createElement("div");
    addCard.className = "p-4 min-h-[110px] rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-700 hover:border-emerald-400 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-center transition-all cursor-pointer flex flex-col items-center justify-center group";
    addCard.onclick = promptAddNewUser;
    addCard.innerHTML = `
    <div class="w-12 h-12 bg-emerald-50 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center mb-2 group-hover:bg-emerald-600 group-hover:text-white transition-all shadow-xs">
      <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
    </div>
    <span class="text-xs font-semibold text-gray-600 dark:text-gray-300 group-hover:text-emerald-700 dark:group-hover:text-emerald-400">Aggiungi</span>
  `;
    grid.appendChild(addCard);
}

async function promptAddNewUser() {
    const name = prompt("Inserisci il nome del nuovo account (solo lettere):");
    if (!name) return;

    const trimmed = name.trim();
    const regex = /^[A-Za-zÀ-ÿ]+(?: [A-Za-zÀ-ÿ]+)*$/;
    if (!regex.test(trimmed)) {
        alert("Errore: il nome deve contenere solo lettere, senza numeri o caratteri speciali.");
        return;
    }

    if (appAccounts.some(a => a.name.toLowerCase() === trimmed.toLowerCase())) {
        alert("Questo account esiste già!");
        return;
    }

    const pin = prompt(`Imposta un PIN di 4 cifre per ${trimmed}:`);
    if (!pin || !/^[0-9]{4}$/.test(pin.trim())) {
        alert("Errore: il PIN deve essere composto esattamente da 4 numeri (es. 1234).");
        return;
    }

    if (supabaseClient) {
        try {
            const { data, error } = await supabaseClient
                .from('accounts')
                .insert([{ name: trimmed, pin: pin.trim() }])
                .select();

            if (error) {
                alert("Errore durante il salvataggio su Supabase: " + error.message);
                return;
            }

            if (data && data.length > 0) {
                appAccounts.push(data[0]);
                renderAuthUsers();
                alert(`Account "${trimmed}" creato con successo!`);
            }
        } catch (err) {
            console.error("Errore di connessione:", err);
            alert("Impossibile contattare il database.");
        }
    }
}

// --- LOGICA AUTENTICAZIONE CON PIN ---
function requestPinAuth(accountId) {
    const acc = appAccounts.find(a => a.id === accountId);
    if (!acc) return;

    pendingUserForPin = acc;
    document.getElementById("pin-user-title").textContent = `Accesso ${acc.name}`;
    document.getElementById("pin-user-avatar").textContent = acc.name.trim().charAt(0).toUpperCase();
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
        if (!dot) continue;
        if (i < enteredPin.length) {
            dot.className = "w-3.5 h-3.5 rounded-full bg-emerald-600 border-2 border-emerald-600 scale-110 transition-all";
        } else {
            dot.className = "w-3.5 h-3.5 rounded-full border-2 border-gray-300 dark:border-gray-600 transition-all";
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

async function verifyPin() {
    if (pendingUserForPin && enteredPin === pendingUserForPin.pin) {
        currentAccountId = pendingUserForPin.id;
        currentAccountName = pendingUserForPin.name;
        pendingUserForPin = null;
        enteredPin = "";
        await loadUserSheets(currentAccountId);
        showView("dashboard");
    } else {
        document.getElementById("pin-error-msg").classList.remove("hidden");
        enteredPin = "";
        updatePinDots();
    }
}

function logoutToAuth() {
    currentAccountId = null;
    currentAccountName = null;
    appSheets = [];
    appPiggyBanks = [];
    showView("auth");
}

function backToDashboard() {
    currentSheetId = null;
    showView("dashboard");
}

// --- GESTIONE RENDICONTO & CHIUSURA DEFINITIVA ---
function openRendiconto(sheetId) {
    const sheet = appSheets.find(s => s.id === sheetId);
    if (!sheet) return;

    const latestDate = appSheets.reduce((max, s) => (s.salaryDate > max ? s.salaryDate : max), "");

    if (sheet.salaryDate >= latestDate) {
        return;
    }

    if (sheet.isLocked) {
        currentSheetId = sheetId;
        showView("rendiconto");
    } else {
        pendingLockSheetId = sheetId;
        const modal = document.getElementById("modal-confirm-lock");
        if (modal) modal.classList.remove("hidden");
    }
}

function closeConfirmLockModal() {
    pendingLockSheetId = null;
    const modal = document.getElementById("modal-confirm-lock");
    if (modal) modal.classList.add("hidden");
}

async function executeConfirmLockAndRendiconto() {
    if (!pendingLockSheetId) return;
    const sheet = appSheets.find(s => s.id === pendingLockSheetId);
    if (!sheet) return;

    sheet.isLocked = true;
    sheet.closedDate = getTodayDateString();

    let totalExpenses = 0;
    (sheet.categories || []).forEach(c => {
        totalExpenses += c.items.reduce((acc, curr) => acc + (Number(curr.value) || 0), 0);
    });
    const income = round2(sheet.income) || 0;
    const totalExtra = (sheet.extraIncomes || []).reduce((acc, curr) => acc + (Number(curr.value) || 0), 0);
    const netSavings = round2((income + totalExtra) - totalExpenses);

    if (netSavings !== 0) {
        await addSavingsToActivePiggyBank(netSavings, sheet.name);
    }

    await saveState();

    currentSheetId = sheet.id;
    closeConfirmLockModal();
    showView("rendiconto");
}

// --- SALVADANAIO ---
async function addSavingsToActivePiggyBank(amount, sheetName) {
    let activePiggy = appPiggyBanks.find(p => !p.isCompleted);
    if (!activePiggy) return;

    activePiggy.currentAmount = round2(activePiggy.currentAmount + amount);
    if (!activePiggy.history || !Array.isArray(activePiggy.history)) {
        activePiggy.history = [];
    }

    activePiggy.history.unshift({
        date: getTodayDateString(),
        sheetName: sheetName || "Mese Chiuso",
        amount: round2(amount)
    });

    if (activePiggy.currentAmount >= activePiggy.targetAmount) {
        activePiggy.isCompleted = true;
        activePiggy.closedDate = new Date().toISOString();
    }

    if (supabaseClient && currentAccountId) {
        const { error } = await supabaseClient.from('piggy_banks').update({
            current_amount: activePiggy.currentAmount,
            is_completed: activePiggy.isCompleted,
            closed_date: activePiggy.closedDate || null,
            history: activePiggy.history
        }).eq('id', activePiggy.id);

        if (error) {
            console.error("Errore aggiornamento salvadanaio su Supabase:", error);
        }
    }
}

function renderPiggyBankView() {
    let piggy = appPiggyBanks.find(p => p.id === viewingPiggyIdtabular);
    if (!piggy) {
        piggy = appPiggyBanks.find(p => !p.isCompleted) || appPiggyBanks[0];
    }
    if (!piggy) {
        openNewPiggyModal();
        return;
    }
    viewingPiggyIdtabular = piggy.id;

    const current = piggy.currentAmount;
    const target = piggy.targetAmount;
    const missing = round2(Math.max(0, target - current));
    let pct = target > 0 ? Math.round((current / target) * 100) : 0;
    if (pct > 100) pct = 100;

    // Calcolo riempimento maialino SVG
    const waterRect = document.getElementById("piggy-water-rect");
    if (waterRect) {
        const svgHeight = 512;
        const targetY = svgHeight - (svgHeight * (pct / 100));
        waterRect.setAttribute("y", targetY);
    }

    const titleEl = document.getElementById("piggy-title");
    if (titleEl) titleEl.textContent = piggy.title;

    const currentAmountEl = document.getElementById("piggy-current-amount");
    if (currentAmountEl) currentAmountEl.textContent = `€${formatCurrency(current)}`;

    const pctTextEl = document.getElementById("piggy-pct-text");
    if (pctTextEl) pctTextEl.textContent = `${pct}%`;

    const progressBarEl = document.getElementById("piggy-progress-bar");
    if (progressBarEl) progressBarEl.style.width = `${pct}%`;

    const badge = document.getElementById("piggy-status-badge");
    const subtitle = document.getElementById("piggy-subtitle-info");
    const datesInfo = document.getElementById("piggy-dates-info");

    const createdFormatted = new Date(piggy.createdAt).toLocaleDateString('it-IT');
    let dateStr = `Aperto il: ${createdFormatted}`;
    if (piggy.closedDate) {
        dateStr += ` • Chiuso il: ${new Date(piggy.closedDate).toLocaleDateString('it-IT')}`;
    }
    if (datesInfo) datesInfo.textContent = dateStr;

    if (piggy.isCompleted && !piggy._fireworked) {
        piggy._fireworked = true;
        triggerFireworks();
    }

    if (piggy.isCompleted) {
        if (badge) {
            badge.textContent = "Obiettivo Raggiunto";
            badge.className = "inline-block px-3 py-1 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300";
        }
        if (subtitle) {
            subtitle.innerHTML = `<span class="text-emerald-600 dark:text-emerald-400 font-bold">Obiettivo raggiunto! 🎉 Totale: €${formatCurrency(current)}</span>`;
        }
    } else {
        if (badge) {
            badge.textContent = "Obiettivo in Corso";
            badge.className = "inline-block px-3 py-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300";
        }
        if (subtitle) {
            subtitle.innerHTML = `Mancano <strong class="text-emerald-600 dark:text-emerald-400 font-bold" id="piggy-missing-amount">€${formatCurrency(missing)}</strong> per raggiungere l'obiettivo di <strong id="piggy-target-amount">€${formatCurrency(target)}</strong>`;
        }
    }

    const historyContainer = document.getElementById("piggy-monthly-history");
    if (historyContainer) {
        historyContainer.innerHTML = "";
        let historyList = piggy.history || [];
        if (typeof historyList === "string") {
            try {
                historyList = JSON.parse(historyList);
            } catch (e) {
                historyList = [];
            }
        }

        if (!Array.isArray(historyList) || historyList.length === 0) {
            historyContainer.innerHTML = `<p class="text-[11px] text-gray-400 italic">Nessun versamento mensile registrato.</p>`;
        } else {
            historyList.forEach(h => {
                const amountVal = Number(h.amount) || 0;
                const sign = amountVal >= 0 ? "+" : "-";
                const colorClass = amountVal >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500";
                const row = document.createElement("div");
                row.className = "flex items-center justify-between p-2.5 rounded-xl bg-emerald-50/50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800 text-xs my-1";
                row.innerHTML = `
                    <div>
                        <div class="font-bold text-gray-800 dark:text-gray-100">${h.sheetName || 'Mese Chiuso'}</div>
                        <div class="text-[10px] text-gray-400">Versato il: ${h.date || ''}</div>
                    </div>
                    <span class="font-extrabold ${colorClass}">${sign}€${formatCurrency(Math.abs(amountVal))}</span>
                `;
                historyContainer.appendChild(row);
            });
        }
    }
}

function renderPiggyListView() {
    const container = document.getElementById("piggy-all-items-container");
    if (!container) return;
    container.innerHTML = "";

    if (appPiggyBanks.length === 0) {
        container.innerHTML = `
            <div class="bg-white dark:bg-gray-800 rounded-3xl p-8 text-center border border-dashed border-gray-200 dark:border-gray-700 space-y-3">
                <p class="text-xs text-gray-500">Nessun salvadanaio creato.</p>
                <button onclick="openNewPiggyModal()" class="bg-emerald-600 text-white text-xs font-semibold px-4 py-2 rounded-xl">Crea il primo obiettivo</button>
            </div>
        `;
        return;
    }

    appPiggyBanks.forEach(p => {
        const isAct = !p.isCompleted;
        const current = p.currentAmount;
        const target = p.targetAmount;
        let pct = target > 0 ? Math.round((current / target) * 100) : 0;
        if (pct > 100) pct = 100;

        const card = document.createElement("div");
        card.className = "bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-gray-700 space-y-3";
        card.innerHTML = `
            <div class="flex items-start justify-between">
                <div>
                    <div class="flex items-center gap-2">
                        <h4 class="text-sm font-bold text-gray-800 dark:text-gray-100">${p.title}</h4>
                        <span class="px-2 py-0.5 rounded text-[10px] font-bold ${isAct ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">
                            ${isAct ? 'Attivo 🎯' : 'Completato 🏆'}
                        </span>
                    </div>
                    <div class="text-[11px] text-gray-400 mt-1">
                        Apertura: ${new Date(p.createdAt).toLocaleDateString('it-IT')} ${p.closedDate ? `• Chiusura: ${new Date(p.closedDate).toLocaleDateString('it-IT')}` : ''}
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    <button onclick="openSpecificPiggy('${p.id}')" class="bg-emerald-50 dark:bg-emerald-900/40 text-emerald-600 text-xs font-bold px-3 py-1.5 rounded-xl cursor-pointer">Apri</button>
                    <button onclick="deletePiggyBank('${p.id}')" class="text-red-500 hover:bg-red-50 p-1.5 rounded-xl cursor-pointer text-xs font-bold">×</button>
                </div>
            </div>
            <div class="flex justify-between text-xs font-bold pt-2 border-t border-gray-100 dark:border-gray-700">
                <span>Accumulati: €${formatCurrency(current)} / €${formatCurrency(target)}</span>
                <span class="text-emerald-600">${pct}%</span>
            </div>
        `;
        container.appendChild(card);
    });
}

function openSpecificPiggy(id) {
    viewingPiggyIdtabular = id;
    showView("piggy-bank");
}

function openNewPiggyModal() {
    document.getElementById("modal-piggy-title").value = "";
    document.getElementById("modal-piggy-target").value = "";
    document.getElementById("modal-new-piggy")?.classList.remove("hidden");
}

function closeNewPiggyModal() {
    document.getElementById("modal-new-piggy")?.classList.add("hidden");
    if (!appPiggyBanks.some(p => !p.isCompleted) && appPiggyBanks.length === 0) {
        backToDashboard();
    }
}

async function confirmCreatePiggyBank() {
    const title = document.getElementById("modal-piggy-title")?.value.trim();
    const targetVal = round2(document.getElementById("modal-piggy-target")?.value);

    if (!title || targetVal <= 0) {
        alert("Inserisci un titolo e un importo obiettivo valido.");
        return;
    }

    if (!supabaseClient || !currentAccountId) return;

    const { data, error } = await supabaseClient.from('piggy_banks').insert([{
        account_id: currentAccountId,
        title: title,
        target_amount: targetVal,
        current_amount: 0,
        is_completed: false,
        history: []
    }]).select();

    if (!error && data && data.length > 0) {
        appPiggyBanks.unshift({
            id: data[0].id,
            title: data[0].title,
            targetAmount: Number(data[0].target_amount),
            currentAmount: Number(data[0].current_amount),
            isCompleted: data[0].is_completed,
            createdAt: data[0].created_at,
            closedDate: data[0].closed_date,
            history: data[0].history || []
        });
        viewingPiggyIdtabular = data[0].id;
        closeNewPiggyModal();
        showView("piggy-bank");
    }
}

function openEditPiggyModal() {
    const piggy = appPiggyBanks.find(p => p.id === viewingPiggyIdtabular);
    if (!piggy) return;
    document.getElementById("modal-edit-piggy-title").value = piggy.title;
    document.getElementById("modal-edit-piggy")?.classList.remove("hidden");
}

function closeEditPiggyModal() {
    document.getElementById("modal-edit-piggy")?.classList.add("hidden");
}

async function confirmEditPiggyBank() {
    const newTitle = document.getElementById("modal-edit-piggy-title")?.value.trim();
    if (!newTitle) return;

    const piggy = appPiggyBanks.find(p => p.id === viewingPiggyIdtabular);
    if (!piggy) return;

    piggy.title = newTitle;
    if (supabaseClient) {
        await supabaseClient.from('piggy_banks').update({ title: newTitle }).eq('id', piggy.id);
    }
    closeEditPiggyModal();
    renderPiggyBankView();
}

async function deleteActivePiggyBank() {
    const piggy = appPiggyBanks.find(p => p.id === viewingPiggyIdtabular);
    if (!piggy) return;
    if (!confirm(`Eliminare l'obiettivo "${piggy.title}"?`)) return;

    if (supabaseClient) {
        await supabaseClient.from('piggy_banks').delete().eq('id', piggy.id);
    }

    appPiggyBanks = appPiggyBanks.filter(p => p.id !== piggy.id);
    const nextPiggy = appPiggyBanks.find(p => !p.isCompleted) || appPiggyBanks[0];
    if (nextPiggy) {
        viewingPiggyIdtabular = nextPiggy.id;
        renderPiggyBankView();
    } else {
        showView('piggy-list');
    }
}

async function deletePiggyBank(id) {
    if (!confirm("Eliminare questo salvadanaio dallo storico?")) return;
    if (supabaseClient) {
        await supabaseClient.from('piggy_banks').delete().eq('id', id);
    }
    appPiggyBanks = appPiggyBanks.filter(p => p.id !== id);
    renderPiggyListView();
}

function triggerFireworks() {
    const canvas = document.getElementById("fireworks-canvas");
    if (!canvas) return;
    canvas.classList.remove("hidden");
    const ctx = canvas.getContext("2d");
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    let particles = [];
    for (let i = 0; i < 60; i++) {
        particles.push({
            x: canvas.width / 2,
            y: canvas.height / 2,
            angle: Math.random() * Math.PI * 2,
            speed: Math.random() * 6 + 2,
            radius: Math.random() * 3 + 1,
            color: `hsl(${Math.random() * 360}, 100%, 50%)`,
            life: 60
        });
    }

    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        particles.forEach((p, index) => {
            p.x += Math.cos(p.angle) * p.speed;
            p.y += Math.sin(p.angle) * p.speed;
            p.life--;
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            ctx.fill();
            if (p.life <= 0) particles.splice(index, 1);
        });

        if (particles.length > 0) {
            requestAnimationFrame(animate);
        } else {
            canvas.classList.add("hidden");
        }
    }
    animate();
}

// --- DASHBOARD FOGLI ---
function renderDashboard() {
    document.getElementById("dash-user-name").textContent = currentAccountName;
    document.getElementById("dash-sheet-count").textContent = `${appSheets.length} ${appSheets.length === 1 ? 'foglio' : 'fogli'}`;

    const container = document.getElementById("dash-sheets-list");
    container.innerHTML = "";

    if (appSheets.length === 0) {
        container.innerHTML = `
      <div class="bg-white dark:bg-gray-800 rounded-2xl p-8 text-center border border-dashed border-gray-200 dark:border-gray-700">
        <p class="text-xs text-gray-500 dark:text-gray-400">Non hai ancora nessun foglio creato per questo profilo.</p>
        <button onclick="openNewSheetModal()" class="mt-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-4 py-2 rounded-xl transition shadow-sm cursor-pointer">
          Crea il tuo primo foglio
        </button>
      </div>
    `;
        return;
    }

    const latestDate = appSheets.reduce((max, s) => (s.salaryDate > max ? s.salaryDate : max), "");

    appSheets.forEach(sheet => {
        let totalExpenses = 0;
        (sheet.categories || []).forEach(c => {
            totalExpenses += c.items.reduce((acc, curr) => acc + (Number(curr.value) || 0), 0);
        });
        const income = round2(sheet.income) || 0;

        let totalExtra = 0;
        if (sheet.extraIncomes && Array.isArray(sheet.extraIncomes)) {
            totalExtra = sheet.extraIncomes.reduce((acc, curr) => acc + (Number(curr.value) || 0), 0);
        }

        const totalAvailable = round2(income + totalExtra);
        const netSavings = round2(totalAvailable - totalExpenses);

        const hasNextSheet = sheet.salaryDate < latestDate;
        const isRendicontoActive = hasNextSheet;
        const isLocked = Boolean(sheet.isLocked) && hasNextSheet;

        const card = document.createElement("div");
        card.className = "bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-xs border border-gray-100 dark:border-gray-700 space-y-3 hover:border-emerald-300 dark:hover:border-emerald-600 transition group";
        card.innerHTML = `
      <div class="flex items-start justify-between gap-2">
        <div class="space-y-1 min-w-0 flex-1">
          <div class="text-sm font-bold text-gray-800 dark:text-gray-100 truncate leading-tight" title="${sheet.name}">
            ${sheet.name}
          </div>
          <div>
            <span class="inline-block text-[11px] bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded-md font-medium whitespace-nowrap">
              Accredito: ${sheet.salaryDate}
            </span>
          </div>
        </div>

        <div class="flex items-center gap-2 shrink-0">
          <button onclick="openEditSheetModal('${sheet.id}')" 
            class="p-1.5 text-gray-400 hover:text-blue-600 transition active:scale-95 flex items-center justify-center cursor-pointer" 
            title="Modifica dati foglio">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:block;">
              <path d="M12 20h9"></path>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
            </svg>
          </button>

          <div class="flex flex-col gap-1.5 items-stretch w-[88px]">
            <button onclick="openSheet('${sheet.id}')" 
              class="w-full flex items-center justify-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 group-hover:text-emerald-700 bg-emerald-50 dark:bg-emerald-900/40 hover:bg-emerald-100/70 py-1.5 rounded-xl transition whitespace-nowrap cursor-pointer">
              <span>${isLocked ? 'Visualizza' : 'Apri'}</span>
              <svg class="w-3.5 h-3.5 transform group-hover:translate-x-0.5 transition-transform shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
              </svg>
            </button>

            <button ${isRendicontoActive ? `onclick="openRendiconto('${sheet.id}')"` : 'disabled'} 
              class="w-full flex items-center justify-center text-[10px] font-bold py-1 rounded-xl transition whitespace-nowrap ${isRendicontoActive
                ? 'bg-sky-100 dark:bg-sky-900/40 hover:bg-sky-200 text-sky-800 dark:text-sky-300 cursor-pointer active:scale-95'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed select-none'
            }">
              <span>Rendiconto</span>
            </button>
          </div>
        </div>
      </div>

      <div class="text-[10px] text-gray-600 dark:text-gray-400 flex items-center justify-between pt-2 border-t border-gray-100 dark:border-gray-700 whitespace-nowrap">
        <span>Stipendio: <strong class="text-gray-900 dark:text-gray-100 font-bold">€${formatCurrency(income)}</strong></span>
        <span>Spese: <strong class="text-gray-900 dark:text-gray-100 font-bold">€${formatCurrency(totalExpenses)}</strong></span>
        <span>Risparmio: <strong class="${netSavings < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'} font-bold">€${formatCurrency(netSavings)}</strong></span>
      </div>
    `;
        container.appendChild(card);
    });
}

function openNewSheetModal() {
    const today = getTodayDateString();
    let minDate = null;
    try {
        minDate = getLatestSheetDate();
    } catch (e) { minDate = null; }

    const dateInput = document.getElementById("modal-sheet-date");

    if (fpCreateInstance) {
        fpCreateInstance.destroy();
    }

    if (dateInput) {
        fpCreateInstance = flatpickr(dateInput, {
            locale: "it",
            dateFormat: "Y-m-d",
            altInput: true,
            altFormat: "j F Y",
            defaultDate: today,
            minDate: minDate || null,
            maxDate: today,
            disableMobile: true,
            static: true
        });
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

async function confirmCreateNewSheet() {
    const nameInput = document.getElementById("modal-sheet-name")?.value.trim();
    const dateInput = document.getElementById("modal-sheet-date")?.value;
    const incomeInput = document.getElementById("modal-sheet-income")?.value.trim();
    const today = getTodayDateString();

    if (!nameInput) {
        document.getElementById("modal-sheet-name")?.focus();
        return;
    }
    if (!dateInput) return;
    if (dateInput > today) return;

    let minDate = null;
    try { minDate = getLatestSheetDate(); } catch (e) { minDate = null; }
    if (minDate && dateInput < minDate) return;

    const incomeVal = round2(incomeInput);
    if (!incomeInput || incomeVal <= 0) {
        document.getElementById("modal-sheet-income")?.focus();
        return;
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
        categories: initialCategories,
        dailyExpenses: [],
        extraIncomes: [],
        isLocked: false
    };

    closeNewSheetModal();
    appSheets.unshift(newSheet);
    currentSheetId = newSheet.id;
    await saveState();

    renderDashboard();
    showView("sheet-detail");
    renderSheetDetail();
}

async function confirmAddExtraIncome() {
    const activeSheet = getActiveSheet();
    if (!activeSheet) return;

    const nameInput = document.getElementById("extra-income-name")?.value.trim();
    const valueInput = document.getElementById("extra-income-value")?.value.trim();

    if (!nameInput) {
        alert("Inserisci una descrizione per l'entrata extra.");
        return;
    }
    const val = round2(String(valueInput).replace(',', '.'));
    if (!valueInput || val <= 0) {
        alert("Inserisci un importo valido.");
        return;
    }

    if (!activeSheet.extraIncomes) activeSheet.extraIncomes = [];
    activeSheet.extraIncomes.unshift({
        id: "extra_" + Date.now(),
        name: nameInput,
        value: val
    });

    await saveState();

    document.getElementById("extra-income-name").value = "";
    document.getElementById("extra-income-value").value = "";

    renderSheetDetail();
}

async function deleteExtraIncome(extraId) {
    const activeSheet = getActiveSheet();
    if (!activeSheet || !activeSheet.extraIncomes) return;

    if (!confirm("Sei sicura di voler eliminare questa entrata extra?")) return;

    activeSheet.extraIncomes = activeSheet.extraIncomes.filter(e => e.id !== extraId);
    await saveState();
    renderSheetDetail();
}

function openEditSheetModal(sheetId) {
    try {
        const sheet = appSheets.find(s => s.id === sheetId);
        if (!sheet) return;
        editingSheetId = sheetId;

        const modal = document.getElementById("modal-edit-sheet");
        if (modal) modal.classList.remove("hidden");

        const today = getTodayDateString();
        const dateInput = document.getElementById("edit-sheet-date");

        if (fpEditInstance) {
            fpEditInstance.destroy();
        }

        if (dateInput) {
            const otherDates = appSheets
                .filter(s => s.id !== sheetId && s.salaryDate)
                .map(s => s.salaryDate)
                .sort();

            const prevDates = otherDates.filter(d => d <= sheet.salaryDate);
            const minDate = prevDates.length > 0 ? prevDates[prevDates.length - 1] : null;

            const nextDates = otherDates.filter(d => d > sheet.salaryDate);
            let maxDate = today;
            if (nextDates.length > 0) {
                maxDate = nextDates[0] < today ? nextDates[0] : today;
            }

            fpEditInstance = flatpickr(dateInput, {
                locale: "it",
                dateFormat: "Y-m-d",
                altInput: true,
                altFormat: "j F Y",
                defaultDate: sheet.salaryDate,
                minDate: minDate || null,
                maxDate: maxDate,
                disableMobile: true,
                static: true
            });
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

async function confirmEditSheet() {
    if (!editingSheetId) return;
    const sheet = appSheets.find(s => s.id === editingSheetId);
    if (!sheet) return;

    const nameInput = document.getElementById("edit-sheet-name")?.value.trim();
    const dateInput = document.getElementById("edit-sheet-date")?.value;
    const incomeInput = document.getElementById("edit-sheet-income")?.value.trim();

    if (!nameInput || !dateInput) return;

    const incomeVal = round2(incomeInput);
    if (!incomeInput || incomeVal <= 0) return;

    sheet.name = nameInput;
    sheet.salaryDate = dateInput;
    sheet.income = incomeVal;

    await saveState();
    closeEditSheetModal();
    renderDashboard();

    if (currentSheetId === sheet.id) {
        renderSheetDetail();
    }
}

function openSheet(sheetId) {
    currentSheetId = sheetId;
    showView("sheet-detail");
}

function getActiveSheet() {
    return appSheets.find(s => s.id === currentSheetId) || null;
}

function renderSheetDetail() {
    const activeSheet = getActiveSheet();
    if (!activeSheet) { backToDashboard(); return; }

    const isLocked = Boolean(activeSheet.isLocked);

    const btnUnlock = document.getElementById("btn-unlock-sheet");
    if (btnUnlock) {
        btnUnlock.classList.add("hidden");
    }

    document.getElementById("current-sheet-title").textContent = activeSheet.name;
    document.getElementById("current-sheet-date").textContent = activeSheet.salaryDate;

    const incomeInput = document.getElementById("input-income");
    incomeInput.value = activeSheet.income || "";
    incomeInput.disabled = isLocked;

    let totalExpenses = 0;
    const catTotals = {};

    activeSheet.categories.forEach(cat => {
        const sum = cat.items.reduce((acc, curr) => acc + (Number(curr.value) || 0), 0);
        catTotals[cat.key] = round2(sum);
        totalExpenses += sum;
    });
    totalExpenses = round2(totalExpenses);

    if (!activeSheet.extraIncomes) activeSheet.extraIncomes = [];
    let totalExtra = activeSheet.extraIncomes.reduce((acc, curr) => acc + (Number(curr.value) || 0), 0);
    totalExtra = round2(totalExtra);

    const income = round2(activeSheet.income);
    const totalAvailable = round2(income + totalExtra);
    const netSavings = round2(totalAvailable - totalExpenses);
    const savingsRatio = totalAvailable > 0 ? Math.round((netSavings / totalAvailable) * 100) : 0;

    const isNegative = netSavings < 0;
    const statSavingsEl = document.getElementById("stat-net-savings");
    const statRatioEl = document.getElementById("stat-savings-ratio");

    if (isNegative) {
        statSavingsEl.className = "text-lg sm:text-2xl font-bold text-red-500 mt-1";
        statRatioEl.className = "text-lg sm:text-2xl font-bold text-red-500 mt-1";
        statSavingsEl.textContent = `-€${formatCurrency(Math.abs(netSavings))}`;
    } else {
        statSavingsEl.className = "text-lg sm:text-2xl font-bold text-emerald-600 mt-1";
        statRatioEl.className = "text-lg sm:text-2xl font-bold text-emerald-600 mt-1";
        statSavingsEl.textContent = `€${formatCurrency(netSavings)}`;
    }

    statRatioEl.textContent = `${savingsRatio}%`;
    document.getElementById("stat-total-expenses").textContent = `€${formatCurrency(totalExpenses)}`;

    const pctRicorrenti = totalExpenses > 0 ? ((catTotals["ricorrenti_base"] || 0) / totalExpenses) * 100 : 0;
    const pctSpot = totalExpenses > 0 ? ((catTotals["uscite_spot"] || 0) / totalExpenses) * 100 : 0;
    const pctVariabili = totalExpenses > 0 ? ((catTotals["spese_variabili"] || 0) / totalExpenses) * 100 : 0;

    document.getElementById("bar-segment-ricorrenti").style.width = `${pctRicorrenti}%`;
    document.getElementById("bar-segment-spot").style.width = `${pctSpot}%`;
    document.getElementById("bar-segment-variabili").style.width = `${pctVariabili}%`;

    renderExtraIncomesList(activeSheet, isLocked);
    renderCategories(activeSheet, totalExpenses);
}

function renderExtraIncomesList(activeSheet, isLocked) {
    const container = document.getElementById("extra-incomes-container");
    const addBoxContainer = document.getElementById("add-extra-income-box");
    if (!container) return;
    container.innerHTML = "";

    if (addBoxContainer) {
        if (isLocked) {
            addBoxContainer.classList.add("hidden");
        } else {
            addBoxContainer.classList.remove("hidden");
        }
    }

    const list = activeSheet.extraIncomes || [];

    list.forEach((extra) => {
        const div = document.createElement("div");
        div.className = "flex items-center justify-between p-2.5 rounded-xl bg-emerald-50/50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800 text-xs";
        div.innerHTML = `
            <div class="flex items-center gap-2 min-w-0 flex-1 pr-2">
                <span class="font-semibold text-gray-800 dark:text-gray-200 truncate">${extra.name}</span>
            </div>
            <div class="flex items-center gap-3 shrink-0">
                <span class="font-bold text-emerald-600 dark:text-emerald-400">+€${formatCurrency(extra.value)}</span>
                ${!isLocked ? `
                <button onclick="deleteExtraIncome('${extra.id}')" class="p-1 text-red-500 hover:text-red-700 transition cursor-pointer" title="Elimina entrata extra">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                </button>` : ''}
            </div>
        `;
        container.appendChild(div);
    });
}

function renderCategories(activeSheet, totalExpenses) {
    const container = document.getElementById("categories-container");
    container.innerHTML = "";
    const isLocked = Boolean(activeSheet.isLocked);

    activeSheet.categories.forEach((cat, catIndex) => {
        const catSum = cat.items.reduce((acc, curr) => acc + (Number(curr.value) || 0), 0);
        const catPct = totalExpenses > 0 ? Math.round((catSum / totalExpenses) * 100) : 0;

        const catDiv = document.createElement("div");
        catDiv.className = "border-t border-gray-100 dark:border-gray-700 pt-4";
        catDiv.innerHTML = `
      <div class="flex items-center justify-between cursor-pointer mb-3 select-none" onclick="toggleCategoryCollapse(${catIndex})">
        <div class="flex items-center gap-2">
          <span class="w-2.5 h-2.5 rounded-full ${cat.badgeClass}"></span>
          <span class="text-sm font-semibold text-gray-800 dark:text-gray-200">${cat.title}</span>
        </div>
        <div class="flex items-center gap-3 text-xs sm:text-sm">
          <span class="text-gray-500 dark:text-gray-400 font-medium">${catPct}%</span>
          <span class="font-bold text-gray-800 dark:text-gray-100">€${formatCurrency(catSum)}</span>
          <svg class="w-4 h-4 text-gray-500 dark:text-gray-400 transform transition-transform ${cat.collapsed ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
          </svg>
        </div>
      </div>
      
      <div id="cat-body-${catIndex}" class="space-y-4 ${cat.collapsed ? 'hidden' : ''}">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 pt-1" id="cat-items-${catIndex}">
        </div>

        ${!isLocked ? `
        <button onclick="promptAddNewItem(${catIndex})" class="mt-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 flex items-center gap-1 cursor-pointer">
          <svg class="w-3.5 h-3.5 fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
          Aggiungi voce a questa sezione
        </button>` : ''}
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
        <div class="flex items-center justify-between text-xs text-gray-700 dark:text-gray-300">
          <span class="truncate max-w-[180px] font-medium" title="${item.name}">${item.name}</span>
          
          ${!isLocked ? `
          <div class="flex items-center gap-0.5">
            <button onclick="renameItem(${catIndex},${itemIndex})" class="p-1 text-blue-600 hover:text-blue-800 transition active:scale-95 flex items-center justify-center cursor-pointer" title="Modifica nome">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:block;">
                <path d="M12 20h9"></path>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
              </svg>
            </button>

            <button onclick="deleteItem(${catIndex},${itemIndex})" class="p-1 text-red-500 hover:text-red-700 transition active:scale-95 flex items-center justify-center cursor-pointer" title="Elimina voce">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:block;">
                <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
              </svg>
            </button>
          </div>` : ''}
        </div>

        <div class="flex items-center gap-3">
          <input 
            type="range" min="0" max="${maxVal}" step="1" value="${rawVal}" 
            tabindex="-1"
            class="custom-slider pointer-events-none select-none opacity-85"
          >
          
          <div class="flex items-center h-[42px] ${isLocked ? 'bg-gray-100/70 dark:bg-gray-700/50 border-gray-200 dark:border-gray-700' : 'bg-[#f1f3f4] dark:bg-gray-700 border-transparent'} rounded-xl px-3 py-2.5 min-w-[95px] max-w-[120px] justify-between border focus-within:border-emerald-500 focus-within:bg-white dark:focus-within:bg-gray-800 transition-all shadow-2xs">
            <span class="text-xs text-gray-400 dark:text-gray-400 font-semibold mr-1 select-none">€</span>
            <input 
              type="text" 
              inputmode="decimal"
              placeholder="0"
              value="${displayVal}" 
              ${isLocked ? 'disabled' : ''}
              onfocus="this.select()"
              onchange="updateItemValue(${catIndex}, ${itemIndex}, this.value)" 
              class="w-full bg-transparent text-right text-sm font-bold text-gray-800 dark:text-gray-100 focus:outline-none placeholder:text-gray-400 placeholder:font-normal leading-normal ${isLocked ? 'cursor-not-allowed text-gray-600 dark:text-gray-400' : ''}"
            >
          </div>
        </div>
      `;
            itemsContainer.appendChild(row);
        });
    });
}

function renderCalendarView() {
    const activeSheet = getActiveSheet();
    if (!activeSheet) {
        backToDashboard();
        return;
    }

    const titleIndicator = document.getElementById("calendar-sheet-title-indicator");
    if (titleIndicator) {
        titleIndicator.textContent = `Calendario: ${activeSheet.name}`;
    }

    if (!activeSheet.dailyExpenses) {
        activeSheet.dailyExpenses = [];
    }

    const dateInput = document.getElementById("calendar-expense-date");
    if (fpCalendarInstance) {
        fpCalendarInstance.destroy();
    }
    if (dateInput) {
        fpCalendarInstance = flatpickr(dateInput, {
            locale: "it",
            dateFormat: "Y-m-d",
            altInput: true,
            altFormat: "j F Y",
            defaultDate: getTodayDateString(),
            minDate: activeSheet.salaryDate,
            maxDate: getTodayDateString(),
            disableMobile: true,
            static: true
        });
    }

    const selectEl = document.getElementById("calendar-expense-item");
    if (selectEl) {
        selectEl.innerHTML = "";
        activeSheet.categories.forEach(cat => {
            cat.items.forEach(item => {
                const opt = document.createElement("option");
                opt.value = item.id;
                opt.dataset.categoryKey = cat.key;
                opt.textContent = `${cat.title} ➔ ${item.name}`;
                selectEl.appendChild(opt);
            });
        });
    }

    renderCalendarExpensesList();
}

async function confirmAddCalendarExpense() {
    const activeSheet = getActiveSheet();
    if (!activeSheet) return;

    const dateVal = document.getElementById("calendar-expense-date")?.value;
    const nameVal = document.getElementById("calendar-expense-name")?.value.trim();
    const valueInput = document.getElementById("calendar-expense-value")?.value.trim();
    const selectItem = document.getElementById("calendar-expense-item");
    const itemId = selectItem?.value;

    if (!dateVal || !nameVal || !valueInput || !itemId) {
        alert("Compila tutti i campi della spesa.");
        return;
    }

    const val = round2(String(valueInput).replace(',', '.'));
    if (val <= 0) return;

    let categoryTitle = "";
    let categoryKey = "";
    activeSheet.categories.forEach(cat => {
        cat.items.forEach(item => {
            if (item.id === itemId) {
                categoryTitle = cat.title;
                categoryKey = cat.key;
            }
        });
    });

    if (!activeSheet.dailyExpenses) activeSheet.dailyExpenses = [];
    activeSheet.dailyExpenses.unshift({
        id: "exp_" + Date.now(),
        date: dateVal,
        name: nameVal,
        value: val,
        itemId: itemId,
        categoryKey: categoryKey,
        categoryTitle: categoryTitle
    });

    activeSheet.dailyExpenses.sort((a, b) => b.date.localeCompare(a.date));
    await saveState();

    document.getElementById("calendar-expense-name").value = "";
    document.getElementById("calendar-expense-value").value = "";
    renderCalendarExpensesList();
}

function renderCalendarExpensesList() {
    const activeSheet = getActiveSheet();
    const container = document.getElementById("calendar-expenses-list");
    if (!container || !activeSheet) return;

    container.innerHTML = "";
    (activeSheet.dailyExpenses || []).forEach(exp => {
        const div = document.createElement("div");
        div.className = "flex items-center justify-between p-3 rounded-2xl bg-gray-50 dark:bg-gray-700/40 border border-gray-100 text-xs";
        div.innerHTML = `
            <div>
                <div class="font-bold text-gray-800 dark:text-gray-100">${exp.name}</div>
                <div class="text-[10px] text-gray-400">${exp.date} • ${exp.categoryTitle}</div>
            </div>
            <div class="flex items-center gap-3">
                <span class="font-extrabold text-gray-900 dark:text-gray-100">€${formatCurrency(exp.value)}</span>
                <button onclick="deleteCalendarExpense('${exp.id}')" class="text-red-500 font-bold cursor-pointer">×</button>
            </div>
        `;
        container.appendChild(div);
    });
}

async function deleteCalendarExpense(expId) {
    const activeSheet = getActiveSheet();
    if (!activeSheet) return;
    activeSheet.dailyExpenses = activeSheet.dailyExpenses.filter(e => e.id !== expId);
    await saveState();
    renderCalendarExpensesList();
}

function renderTrackerView() {
    if (appSheets.length === 0) { backToDashboard(); return; }
    if (!currentSheetId || !appSheets.some(s => s.id === currentSheetId)) {
        currentSheetId = appSheets[0].id;
    }

    const selector = document.getElementById("tracker-sheet-selector");
    if (selector) {
        selector.innerHTML = "";
        appSheets.forEach(sheet => {
            const opt = document.createElement("option");
            opt.value = sheet.id;
            opt.textContent = `${sheet.name} (${sheet.salaryDate})`;
            if (sheet.id === currentSheetId) opt.selected = true;
            selector.appendChild(opt);
        });
    }

    const activeSheet = getActiveSheet();
    if (!activeSheet) return;

    document.getElementById("tracker-sheet-title-indicator").textContent = `Tracker: ${activeSheet.name}`;

    let totalBudget = 0;
    activeSheet.categories.forEach(cat => {
        cat.items.forEach(item => { totalBudget += Number(item.value) || 0; });
    });

    let totalSpent = 0;
    (activeSheet.dailyExpenses || []).forEach(exp => { totalSpent += Number(exp.value) || 0; });

    const openToSpend = round2(totalBudget - totalSpent);
    document.getElementById("tracker-hero-budget").textContent = `€${formatCurrency(totalBudget)}`;
    document.getElementById("tracker-hero-speso").textContent = `€${formatCurrency(totalSpent)}`;
    document.getElementById("tracker-hero-residuo").textContent = `€${formatCurrency(openToSpend)}`;

    const spentByItemMap = {};
    (activeSheet.dailyExpenses || []).forEach(exp => {
        spentByItemMap[exp.itemId] = (spentByItemMap[exp.itemId] || 0) + (Number(exp.value) || 0);
    });

    const categoriesContainer = document.getElementById("tracker-categories-list");
    if (!categoriesContainer) return;
    categoriesContainer.innerHTML = "";

    activeSheet.categories.forEach(cat => {
        let catBudget = 0;
        let catSpent = 0;

        cat.items.forEach(item => {
            catBudget += Number(item.value) || 0;
            catSpent += spentByItemMap[item.id] || 0;
        });

        catBudget = round2(catBudget);
        catSpent = round2(catSpent);
        const catResiduo = round2(catBudget - catSpent);

        const catSection = document.createElement("div");
        catSection.className = "space-y-3 pt-3 border-t border-gray-100 dark:border-gray-700 first:border-0 first:pt-0";

        let itemsHtml = "";
        cat.items.forEach(item => {
            const itemBudget = Number(item.value) || 0;
            const itemSpent = spentByItemMap[item.id] || 0;
            const itemResiduo = round2(itemBudget - itemSpent);
            const isItemNeg = itemResiduo < 0;

            let pct = itemBudget > 0 ? Math.round((itemSpent / itemBudget) * 100) : (itemSpent > 0 ? 100 : 0);
            if (pct > 100) pct = 100;

            let barColor = "bg-emerald-500";
            if (pct >= 85 && pct < 100) barColor = "bg-amber-500";
            if (pct >= 100 || isItemNeg) barColor = "bg-red-500";

            itemsHtml += `
                <div class="py-2.5 border-b border-gray-50 dark:border-gray-700/50 text-xs space-y-1.5">
                    <div class="flex items-center justify-between">
                        <div class="pr-2 min-w-0 flex-1">
                            <span class="font-semibold text-gray-800 dark:text-gray-200 truncate">${item.name}</span>
                            <span class="text-[10px] font-normal text-gray-500 ml-1">(Budget: €${formatCurrency(itemBudget)})</span>
                        </div>
                        <div class="text-right shrink-0">
                            <div class="font-bold ${isItemNeg ? 'text-red-500' : 'text-emerald-600 dark:text-emerald-400'}">
                                ${isItemNeg ? '-' : ''}€${formatCurrency(Math.abs(itemResiduo))}
                            </div>
                            <div class="text-[9px] text-gray-400 uppercase tracking-tight">${isItemNeg ? 'Sforato' : 'Rimasto'}</div>
                        </div>
                    </div>
                    <div class="space-y-1">
                        <div class="flex justify-between text-[10px] text-gray-400">
                            <span>Speso: €${formatCurrency(itemSpent)}</span>
                            <span>${pct}%</span>
                        </div>
                        <div class="w-full h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                            <div class="h-full ${barColor} transition-all duration-300 rounded-full" style="width: ${pct}%;"></div>
                        </div>
                    </div>
                </div>
            `;
        });

        catSection.innerHTML = `
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-2 pr-2">
                    <span class="w-2.5 h-2.5 rounded-full shrink-0 ${cat.badgeClass}"></span>
                    <span class="text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300 truncate">${cat.title}</span>
                </div>
                <div class="text-xs font-bold shrink-0 ${catResiduo < 0 ? 'text-red-500' : 'text-gray-800 dark:text-gray-100'}">
                    Residuo: ${catResiduo < 0 ? '-' : ''}€${formatCurrency(Math.abs(catResiduo))}
                </div>
            </div>
            <div class="pl-4 space-y-1">
                ${itemsHtml}
            </div>
        `;
        categoriesContainer.appendChild(catSection);
    });
}

function onTrackerSheetChange(sheetId) {
    currentSheetId = sheetId;
    renderTrackerView();
}

function renderRendicontoView() {
    const activeSheet = getActiveSheet();
    if (!activeSheet) { backToDashboard(); return; }

    document.getElementById("rendiconto-sheet-title").textContent = activeSheet.name;
    document.getElementById("rendiconto-date-start").textContent = activeSheet.salaryDate;
    document.getElementById("rendiconto-date-end").textContent = activeSheet.closedDate || getTodayDateString();

    const income = round2(activeSheet.income);
    let totalExtra = 0;
    if (activeSheet.extraIncomes && Array.isArray(activeSheet.extraIncomes)) {
        totalExtra = activeSheet.extraIncomes.reduce((acc, curr) => acc + (Number(curr.value) || 0), 0);
    }
    const totalAvailable = round2(income + totalExtra);

    let totalExpenses = 0;
    const catAmounts = [];
    const catLabels = [];
    const catColors = [];
    const allItems = [];

    activeSheet.categories.forEach(cat => {
        let sum = 0;
        cat.items.forEach(item => {
            const v = Number(item.value) || 0;
            sum += v;
            if (v > 0) allItems.push({ name: item.name, value: v, category: cat.title });
        });
        sum = round2(sum);
        totalExpenses += sum;
        catAmounts.push(sum);
        catLabels.push(cat.title);
        catColors.push(cat.color || "#10b981");
    });

    totalExpenses = round2(totalExpenses);
    const netSavings = round2(totalAvailable - totalExpenses);

    const heroSavingsEl = document.getElementById("rendiconto-hero-savings");
    if (netSavings < 0) {
        heroSavingsEl.className = "text-2xl sm:text-3xl font-extrabold text-red-500";
        heroSavingsEl.textContent = `-€${formatCurrency(Math.abs(netSavings))}`;
    } else {
        heroSavingsEl.className = "text-2xl sm:text-3xl font-extrabold text-emerald-600";
        heroSavingsEl.textContent = `€${formatCurrency(netSavings)}`;
    }

    document.getElementById("rendiconto-hero-income").textContent = `€${formatCurrency(totalAvailable)}`;
    document.getElementById("rendiconto-hero-expenses").textContent = `€${formatCurrency(totalExpenses)}`;

    const ctx = document.getElementById("rendicontoPieChart")?.getContext("2d");
    if (ctx) {
        if (rendicontoChartInstance) {
            rendicontoChartInstance.destroy();
        }
        rendicontoChartInstance = new Chart(ctx, {
            type: "doughnut",
            data: {
                labels: catLabels,
                datasets: [{
                    data: catAmounts.every(v => v === 0) ? [1] : catAmounts,
                    backgroundColor: catAmounts.every(v => v === 0) ? ["#e5e7eb"] : catColors,
                    borderWidth: 2,
                    borderColor: document.documentElement.classList.contains('dark') ? "#1f2937" : "#ffffff"
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                animation: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        enabled: !catAmounts.every(v => v === 0),
                        callbacks: {
                            label: (context) => ` €${context.raw}`
                        }
                    }
                },
                cutout: "68%"
            }
        });
    }

    const legContainer = document.getElementById("rendiconto-legend");
    legContainer.innerHTML = "";
    activeSheet.categories.forEach((cat, idx) => {
        const sum = catAmounts[idx];
        const pct = totalExpenses > 0 ? Math.round((sum / totalExpenses) * 100) : 0;
        const row = document.createElement("div");
        row.className = "flex items-center justify-between";
        row.innerHTML = `
            <div class="flex items-center gap-1.5">
                <span class="w-2.5 h-2.5 rounded-full" style="background-color: ${cat.color};"></span>
                <span class="text-gray-700 dark:text-gray-300 font-medium">${cat.title}</span>
            </div>
            <span class="font-bold text-gray-800 dark:text-gray-100">€${formatCurrency(sum)} (${pct}%)</span>
        `;
        legContainer.appendChild(row);
    });

    allItems.sort((a, b) => b.value - a.value);
    const top3 = allItems.slice(0, 3);
    const topContainer = document.getElementById("rendiconto-top-items");
    topContainer.innerHTML = "";

    if (top3.length === 0) {
        topContainer.innerHTML = `<p class="text-xs text-gray-400 italic">Nessuna voce di spesa registrata.</p>`;
    } else {
        top3.forEach((item, index) => {
            const medals = ["🥇", "🥈", "🥉"];
            const div = document.createElement("div");
            div.className = "flex items-center justify-between p-2 rounded-xl bg-gray-50 dark:bg-gray-700/40 border border-gray-100 dark:border-gray-700 text-xs";
            div.innerHTML = `
                <div class="flex items-center gap-2">
                    <span class="text-base leading-none">${medals[index]}</span>
                    <div>
                        <span class="font-semibold text-gray-800 dark:text-gray-200">${item.name}</span>
                        <span class="text-[10px] text-gray-400 block">${item.category}</span>
                    </div>
                </div>
                <span class="font-bold text-gray-900 dark:text-gray-100">€${formatCurrency(item.value)}</span>
            `;
            topContainer.appendChild(div);
        });
    }
}

async function handleIncomeChange(val) {
    const activeSheet = getActiveSheet();
    if (!activeSheet) return;
    const normalizedVal = String(val).replace(',', '.');
    activeSheet.income = round2(normalizedVal);
    await saveState();
    renderSheetDetail();
}

async function updateItemValue(catIndex, itemIndex, val) {
    const activeSheet = getActiveSheet();
    if (!activeSheet) return;
    const normalizedVal = String(val).replace(',', '.');
    activeSheet.categories[catIndex].items[itemIndex].value = round2(normalizedVal);
    await saveState();
    renderSheetDetail();
}

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

async function confirmRenameItem() {
    if (!pendingActionItem) return;
    const { catIndex, itemIndex } = pendingActionItem;
    const activeSheet = getActiveSheet();
    if (!activeSheet) { closeRenameModal(); return; }

    const input = document.getElementById("input-rename-item");
    const newName = input ? input.value.trim() : "";
    if (newName) {
        activeSheet.categories[catIndex].items[itemIndex].name = newName;
        await saveState();
        renderSheetDetail();
    }
    closeRenameModal();
}

async function promptAddNewItem(catIndex) {
    const name = prompt("Nome della nuova voce (es. Bolletta luce, Taxi, Cena):");
    if (!name || !name.trim()) return;

    const activeSheet = getActiveSheet();
    if (!activeSheet) return;

    activeSheet.categories[catIndex].items.push({
        id: "item_" + Date.now(), name: name.trim(), value: 0, max: 200
    });
    await saveState();
    renderSheetDetail();
}

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

async function confirmExecuteDeleteItem() {
    if (!pendingActionItem) return;
    const { catIndex, itemIndex } = pendingActionItem;
    const activeSheet = getActiveSheet();
    if (!activeSheet) { closeDeleteItemModal(); return; }

    activeSheet.categories[catIndex].items.splice(itemIndex, 1);
    await saveState();
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

async function executeDeleteCurrentSheet() {
    const activeSheet = getActiveSheet();
    if (!activeSheet) {
        closeDeleteSheetModal();
        return;
    }

    await deleteSheetFromCloud(activeSheet.id);
    appSheets = appSheets.filter(s => s.id !== activeSheet.id);

    if (appSheets.length > 0) {
        const latestDate = appSheets.reduce((max, s) => (s.salaryDate > max ? s.salaryDate : max), "");
        appSheets.forEach(sheet => {
            const hasNextSheet = sheet.salaryDate < latestDate;
            if (!hasNextSheet) {
                sheet.isLocked = false;
                delete sheet.closedDate;
            }
        });
    }

    await saveState();
    closeDeleteSheetModal();
    backToDashboard();
}

function exportToExcel() {
    const activeSheet = getActiveSheet();
    if (!activeSheet) return;

    const rows = [];
    rows.push(["PROFILO", currentAccountName]);
    rows.push(["FOGLIO", activeSheet.name]);
    rows.push(["DATA ACCREDITO", activeSheet.salaryDate]);
    if (activeSheet.closedDate) {
        rows.push(["DATA CHIUSURA BILANCIO", activeSheet.closedDate]);
    }
    rows.push(["STIPENDIO / ENTRATA (€)", activeSheet.income]);

    if (activeSheet.extraIncomes && activeSheet.extraIncomes.length > 0) {
        rows.push([]);
        rows.push(["ENTRATE EXTRA", "DESCRIZIONE", "IMPORTO (€)"]);
        activeSheet.extraIncomes.forEach(ex => {
            rows.push(["Extra", ex.name, ex.value]);
        });
    }

    rows.push([]);
    rows.push(["SEZIONE", "VOCE DI SPESA", "IMPORTO (€)"]);

    let total = 0;
    activeSheet.categories.forEach(cat => {
        cat.items.forEach(item => {
            rows.push([cat.title, item.name, Number(item.value) || 0]);
            total += Number(item.value) || 0;
        });
    });

    let totalExtra = (activeSheet.extraIncomes || []).reduce((acc, curr) => acc + (Number(curr.value) || 0), 0);
    let totalIncomeFinal = (Number(activeSheet.income) || 0) + totalExtra;

    rows.push([]);
    rows.push(["TOTALE SPESE (€)", "", total]);
    rows.push(["RISPARMIO NETTO (€)", "", totalIncomeFinal - total]);

    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Budget Mese");

    const fileName = `saveMoney_${currentAccountName}_${activeSheet.name.replace(/\s+/g, "_")}.xlsx`;
    XLSX.writeFile(workbook, fileName);
}

async function exportRendicontoToPDF() {
    const activeSheet = getActiveSheet();
    if (!activeSheet) return;

    const sourceEl = document.getElementById("rendiconto-card-printable");
    if (!sourceEl) {
        alert("Errore: scheda rendiconto non trovata.");
        return;
    }

    if (typeof html2pdf === "undefined") {
        alert("Libreria PDF non ancora pronta. Attendi un istante e riprova.");
        return;
    }

    const footerEl = document.getElementById("pdf-exclusive-footer");
    const timestampEl = document.getElementById("pdf-footer-timestamp");
    if (footerEl && timestampEl) {
        const now = new Date();
        const d = String(now.getDate()).padStart(2, '0');
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const y = now.getFullYear();
        const hr = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        timestampEl.textContent = `${d}/${m}/${y} ${hr}:${min}`;
        footerEl.classList.remove("hidden");
    }

    const opt = {
        margin: [6, 6, 6, 6],
        filename: `saveMoney_Rendiconto_${currentAccountName}_${activeSheet.name.replace(/\s+/g, '_')}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
            scale: 2,
            useCORS: true,
            logging: false,
            scrollY: 0
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    try {
        await html2pdf().set(opt).from(sourceEl).save();
    } catch (err) {
        console.error("Errore generazione PDF:", err);
        alert("Si è verificato un errore durante la creazione del PDF.");
    } finally {
        if (footerEl) {
            footerEl.classList.add("hidden");
        }
    }
}

document.addEventListener("DOMContentLoaded", initApp);