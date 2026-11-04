import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, doc, setDoc, deleteDoc, onSnapshot, collection, writeBatch, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// ==========================================
// 0. CUSTOM MODAL (ALERTS)
// ==========================================
window.customAlert = function(message) {
    document.getElementById('alertMessage').innerText = message;
    document.getElementById('customAlertModal').classList.remove('hidden');
    document.getElementById('customAlertModal').classList.add('flex');
};

window.customConfirm = function(message) {
    return new Promise((resolve) => {
        document.getElementById('confirmMessage').innerText = message;
        const modal = document.getElementById('customConfirmModal');
        modal.classList.remove('hidden'); modal.classList.add('flex');

        document.getElementById('btnConfirmYes').onclick = () => {
            modal.classList.add('hidden'); modal.classList.remove('flex'); resolve(true);
        };
        document.getElementById('btnConfirmNo').onclick = () => {
            modal.classList.add('hidden'); modal.classList.remove('flex'); resolve(false);
        };
    });
};

// ==========================================
// 1. FIREBASE CONFIG & DATA
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyAdUlZY2GRGQj6EbqujYgAOJmmma31qftk",
  authDomain: "jadual-his-sgbuloh.firebaseapp.com",
  databaseURL: "https://jadual-his-sgbuloh-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "jadual-his-sgbuloh",
  storageBucket: "jadual-his-sgbuloh.firebasestorage.app",
  messagingSenderId: "786052008185",
  appId: "1:786052008185:web:b34351626aa59bd2b1fa28"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let staffs = { OH: [], A: [], B: [] }; 
let allStaffNames = [];
let localDataCache = {}; 
let globalSettings = { pattern: "4334", seedDate: "" }; 

const todayDate = new Date();
let currentYearMonth = `${todayDate.getFullYear()}-${(todayDate.getMonth()+1).toString().padStart(2, '0')}`;

const shiftOptions = ["", "OH", "AM", "PM", "AL", "UPL", "EL", "MC", "SWP", "AM-OT", "PM-OT", "PH", "CL", "OC"];
const daysName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const monthNamesEn = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];

const selangorPH = {
    "2026-01-01": "New Year", "2026-02-17": "Chinese New Year", "2026-02-18": "Chinese New Year (Day 2)",
    "2026-03-03": "Nuzul Al-Quran", "2026-03-20": "Hari Raya Aidilfitri", "2026-03-21": "Hari Raya Aidilfitri (Day 2)",
    "2026-05-01": "Labour Day", "2026-05-27": "Hari Raya Aidiladha", "2026-05-31": "Wesak Day",
    "2026-06-01": "YDP Agong's Birthday", "2026-06-16": "Awal Muharram", "2026-08-31": "National Day",
    "2026-09-16": "Malaysia Day", "2026-11-08": "Deepavali", "2026-12-11": "Sultan of Selangor's Birthday", "2026-12-25": "Christmas"
};

// ==========================================
// 2. MONTH NAVIGATION
// ==========================================
function updateMonthDisplayUI() {
    const [y, m] = currentYearMonth.split('-');
    document.getElementById('currentMonthDisplay').innerText = `${monthNamesEn[parseInt(m)-1]} ${y}`;
}

function handleMonthChange(offset) {
    let [y, m] = currentYearMonth.split('-').map(Number);
    m += offset;
    if (m > 12) { m = 1; y++; } else if (m < 1) { m = 12; y--; }
    
    const nextStr = `${y}-${m.toString().padStart(2, '0')}`;
    const selectedDate = new Date(y, m - 1, 1);
    const today = new Date();
    
    if (selectedDate.getFullYear() > today.getFullYear() || (selectedDate.getFullYear() === today.getFullYear() && selectedDate.getMonth() > today.getMonth())) {
        const isNextMonth = (selectedDate.getMonth() === (today.getMonth() + 1) % 12);
        if (isNextMonth && today.getDate() < 15) {
            customAlert(`System Access Denied.\n\nThe schedule for the upcoming month is locked. Auto-generation triggers on the 15th of the current month.`);
            return;
        }
    }
    currentYearMonth = nextStr;
    updateMonthDisplayUI();
    generateTable();
}
document.getElementById('btnPrevMonth').addEventListener('click', () => handleMonthChange(-1));
document.getElementById('btnNextMonth').addEventListener('click', () => handleMonthChange(1));
function getDaysInMonth(year, month) { return new Date(year, month, 0).getDate(); }

// ==========================================
// 3. AUTO-CALCULATE OT (16TH - 15TH)
// ==========================================
const otModal = document.getElementById('otModal');

async function calculateOTLogic() {
    const resultContainer = document.getElementById('otResultContainer');
    
    resultContainer.innerHTML = `
        <div class="flex flex-col items-center justify-center py-10 text-emerald-600">
            <svg class="animate-spin w-8 h-8 mb-4 opacity-80" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <div class="font-extrabold text-xs tracking-widest uppercase">Fetching Records</div>
            <div class="text-[10px] text-slate-500 mt-1 font-semibold">Processing 7-day cycles...</div>
        </div>`;
    
    try {
        const [yearStr, monthStr] = currentYearMonth.split('-');
        let y = parseInt(yearStr);
        let m = parseInt(monthStr);

        let startDateStr = `${y}-${m.toString().padStart(2, '0')}-16`;
        let nextM = m + 1; let nextY = y;
        if(nextM > 12) { nextM = 1; nextY++; }
        let endDateStr = `${nextY}-${nextM.toString().padStart(2, '0')}-15`;

        const q = query(collection(db, "schedules"), 
                        where("date", ">=", startDateStr), 
                        where("date", "<=", endDateStr));
        
        const querySnapshot = await getDocs(q);
        let shiftData = {}; 
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            if(!shiftData[data.staff]) shiftData[data.staff] = {};
            shiftData[data.staff][data.date] = data.shift;
        });

        let startDate = new Date(y, m-1, 16);
        let endDate = new Date(nextY, nextM-1, 15);
        let cycles = [];
        let tempDate = new Date(startDate);
        
        while(tempDate <= endDate) {
            let cycleStart = new Date(tempDate);
            let cycleEnd = new Date(tempDate);
            cycleEnd.setDate(cycleEnd.getDate() + 6);
            if (cycleEnd > endDate) { cycleEnd = new Date(endDate); }
            cycles.push({ start: cycleStart, end: cycleEnd });
            tempDate.setDate(tempDate.getDate() + 7);
        }

        let resultHTML = "";
        const shiftStaffsOnly = [...staffs.A, ...staffs.B];

        shiftStaffsOnly.forEach(staff => {
            let carryForward = 0;
            let staffOTs = [];
            
            cycles.forEach(cycle => {
                let workDays = 0;
                let d = new Date(cycle.start);
                
                while(d <= cycle.end) {
                    let dStr = `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')}`;
                    let s = (shiftData[staff] && shiftData[staff][dStr]) ? shiftData[staff][dStr] : "";
                    
                    if(["AM", "PM", "AM-OT", "PM-OT"].includes(s)) { workDays++; }
                    d.setDate(d.getDate() + 1);
                }
                
                let effectiveDays = workDays + carryForward;
                
                if(effectiveDays >= 4) {
                    let formatStart = `${cycle.start.getDate()}hb`;
                    let mNum = (cycle.end.getMonth()+1).toString().padStart(2,'0');
                    let formatEnd = `${cycle.end.getDate()}hb ${mNum}`; 
                    
                    let claimBadge = `<span class="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded text-[9px] font-black border border-emerald-200 shadow-sm">CLAIM</span>`;
                    
                    if(effectiveDays >= 5) { 
                        let cfBadge = `<span class="bg-amber-100 text-amber-700 px-2 py-0.5 rounded text-[9px] font-black border border-amber-200 shadow-sm">+1 CF</span>`;
                        staffOTs.push(`<div class="flex justify-between items-center bg-white p-2 rounded-lg border border-slate-100 shadow-sm mb-1.5"><span class="font-bold text-slate-700">${formatStart} - ${formatEnd}</span> <div class="flex gap-1">${claimBadge} ${cfBadge}</div></div>`);
                    } else {
                        staffOTs.push(`<div class="flex justify-between items-center bg-white p-2 rounded-lg border border-slate-100 shadow-sm mb-1.5"><span class="font-bold text-slate-700">${formatStart} - ${formatEnd}</span> ${claimBadge}</div>`);
                    }
                    
                    if(effectiveDays >= 5) { carryForward = effectiveDays - 4; } 
                    else { carryForward = 0; }
                } else {
                    carryForward = 0;
                }
            });
            
            if(staffOTs.length > 0) {
                let isTeamA = staffs.A.includes(staff);
                let badgeClass = isTeamA ? "staff-badge-A" : "staff-badge-B";
                let teamLabel = isTeamA ? "TEAM A" : "TEAM B";

                resultHTML += `
                <div class="bg-white/80 backdrop-blur-md border border-white rounded-[20px] shadow-sm mb-4 overflow-hidden relative">
                    <div class="p-4 px-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                        <div class="font-extrabold text-[13px] tracking-wide text-slate-800 flex items-center gap-2">
                            <svg class="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
                            ${staff}
                        </div>
                        <span class="${badgeClass}">${teamLabel}</span>
                    </div>
                    <div class="p-4 px-5 bg-white/40 flex flex-col gap-2 text-[11px]">
                        ${staffOTs.join('')}
                    </div>
                </div>`;
            }
        });
        
        if(resultHTML === "") {
            resultHTML = `
            <div class="flex flex-col items-center justify-center py-10 text-slate-400">
                <svg class="w-10 h-10 mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                <div class="text-sm font-extrabold text-slate-500 uppercase tracking-widest">No Data Found</div>
                <div class="text-[11px] font-semibold mt-1">No shift staff eligible for OT claim.</div>
            </div>`;
        }
            
        setTimeout(() => { resultContainer.innerHTML = resultHTML; }, 300);

    } catch (error) {
        console.error(error);
        resultContainer.innerHTML = `<div class="text-center text-red-500 font-bold text-[11px] py-4">System error: Unable to fetch records.</div>`;
    }
}

document.getElementById('btnOpenOTModal').addEventListener('click', () => { 
    otModal.classList.remove('hidden'); otModal.classList.add('flex'); 
    
    const [y, m] = currentYearMonth.split('-');
    let nextM = parseInt(m) + 1;
    let nextY = parseInt(y);
    if(nextM > 12) { nextM = 1; nextY++; }
    
    document.getElementById('otPeriodText').innerText = `16 ${monthNamesEn[parseInt(m)-1]} ${y} - 15 ${monthNamesEn[nextM-1]} ${nextY}`;
    calculateOTLogic();
});

const closeOT = () => { otModal.classList.add('hidden'); otModal.classList.remove('flex'); };
if (document.getElementById('btnCloseOTModal')) document.getElementById('btnCloseOTModal').addEventListener('click', closeOT);
if (document.getElementById('btnCalculateOT')) document.getElementById('btnCalculateOT').addEventListener('click', calculateOTLogic);

// ==========================================
// 4. STAFF MANAGEMENT & SETTINGS
// ==========================================
function listenToSettings() {
    onSnapshot(doc(db, "settings", "roster"), (docSnap) => {
        if (docSnap.exists()) {
            globalSettings = docSnap.data();
            document.getElementById('masterPattern').value = globalSettings.pattern || "4334";
            document.getElementById('masterSeedDate').value = globalSettings.seedDate || "";
            document.getElementById('displayCurrentPattern').innerText = globalSettings.pattern || "NONE";
            checkAndRunAutoGenerate();
        }
    });
}

function listenToStaffList() {
    onSnapshot(collection(db, "staff_list"), (snapshot) => {
        staffs = { OH: [], A: [], B: [] };
        allStaffNames = [];
        if (snapshot.empty) { seedDefaultStaff(); } 
        else {
            let rawList = [];
            snapshot.forEach(docSnap => rawList.push(docSnap.data()));
            rawList.sort((a, b) => (a.order || 0) - (b.order || 0)); 
            rawList.forEach(data => {
                if (data.team === 'OH') staffs.OH.push(data.name);
                else if (data.team === 'A') staffs.A.push(data.name);
                else if (data.team === 'B') staffs.B.push(data.name);
                allStaffNames.push(data.name);
            });
            generateTable();
            renderStaffModalUI();
            checkAndRunAutoGenerate(); 
        }
    });
}

async function seedDefaultStaff() {
    const batch = writeBatch(db);
    const defaultList = [
        { name: "WAHIDA", team: "OH", order: 0 },
        { name: "IZZUDDIN", team: "A", order: 0 }, { name: "SYAIDATUL", team: "A", order: 1 }, { name: "SYABIL", team: "A", order: 2 }, { name: "ALIFF", team: "A", order: 3 },
        { name: "DIANA", team: "B", order: 0 }, { name: "MUSTAQIM", team: "B", order: 1 }, { name: "SAZWAN", team: "B", order: 2 }, { name: "DANIE", team: "B", order: 3 }
    ];
    defaultList.forEach(s => batch.set(doc(db, "staff_list", s.name), { name: s.name, team: s.team, order: s.order }));
    batch.set(doc(db, "settings", "roster"), { pattern: "4334", seedDate: "2026-09-01" });
    await batch.commit();
}

document.getElementById('btnSaveSettings').addEventListener('click', async () => {
    const pattern = document.getElementById('masterPattern').value.trim();
    const seedDate = document.getElementById('masterSeedDate').value;
    if (!pattern.match(/^[0-9]+$/)) { customAlert("Invalid input. Pattern must only contain numeric values (e.g., 4334)."); return; }
    if (!seedDate) { customAlert("Reference Date is required for the algorithm."); return; }
    await setDoc(doc(db, "settings", "roster"), { pattern, seedDate }, { merge: true });
    customAlert("System Settings Successfully Saved.");
});

const staffModal = document.getElementById('staffModal');
document.getElementById('btnOpenStaffModal').addEventListener('click', () => { staffModal.classList.remove('hidden'); staffModal.classList.add('flex'); });
document.getElementById('btnCloseStaffModal').addEventListener('click', () => { staffModal.classList.add('hidden'); staffModal.classList.remove('flex'); });

document.getElementById('btnAddStaff').addEventListener('click', async () => {
    const nameInput = document.getElementById('newStaffName');
    const teamInput = document.getElementById('newStaffTeam');
    const nameVal = nameInput.value.toUpperCase().trim();
    if (nameVal === "") return;
    if (allStaffNames.includes(nameVal)) { customAlert("Duplicate Entry: Staff name already exists in the system."); return; }
    const newOrder = staffs[teamInput.value].length;
    await setDoc(doc(db, "staff_list", nameVal), { name: nameVal, team: teamInput.value, order: newOrder });
    nameInput.value = "";
});

window.deleteStaff = async function(staffName) {
    if (await customConfirm(`Are you sure you want to completely remove ${staffName} from the database?`)) {
        await deleteDoc(doc(db, "staff_list", staffName));
    }
};

function renderStaffModalUI() {
    const container = document.getElementById('staffListContainer');
    let html = "";
    const renderTeam = (teamArray, badgeClass, title, teamKey) => {
        if (teamArray.length === 0) return;
        html += `<div class="category-header">${title}</div>`;
        html += `<div class="team-sort-group" data-team="${teamKey}">`;
        teamArray.forEach(name => {
            html += `<div class="staff-list-item" draggable="true" data-name="${name}" data-team="${teamKey}">
                        <div class="staff-item-left">
                            <span class="drag-handle" title="Drag to sort">≡</span>
                            <span class="${badgeClass}">${title.replace(' LIST', '')}</span> 
                            <strong class="text-slate-700 tracking-wide text-sm">${name}</strong>
                        </div>
                        <button onclick="deleteStaff('${name}')" class="action-btn-red">✕ Remove</button>
                     </div>`;
        });
        html += `</div>`;
    }
    renderTeam(staffs.OH, 'staff-badge-OH', 'Office Hour', 'OH');
    renderTeam(staffs.A, 'staff-badge-A', 'Team A', 'A');
    renderTeam(staffs.B, 'staff-badge-B', 'Team B', 'B');
    container.innerHTML = html;
    attachDragAndDrop();
}

function attachDragAndDrop() {
    const groups = document.querySelectorAll('.team-sort-group');
    const draggables = document.querySelectorAll('.staff-list-item');
    draggables.forEach(draggable => {
        draggable.addEventListener('dragstart', () => { draggable.classList.add('dragging'); });
        draggable.addEventListener('dragend', async () => {
            draggable.classList.remove('dragging');
            const teamKey = draggable.dataset.team;
            const group = document.querySelector(`.team-sort-group[data-team="${teamKey}"]`);
            const items = group.querySelectorAll('.staff-list-item');
            const batch = writeBatch(db);
            items.forEach((item, index) => { batch.set(doc(db, "staff_list", item.dataset.name), { order: index }, { merge: true }); });
            await batch.commit();
        });
    });
    groups.forEach(group => {
        group.addEventListener('dragover', e => {
            e.preventDefault();
            const afterElement = getDragAfterElement(group, e.clientY);
            const draggable = document.querySelector('.dragging');
            if (draggable && draggable.dataset.team === group.dataset.team) {
                if (afterElement == null) { group.appendChild(draggable); } else { group.insertBefore(draggable, afterElement); }
            }
        });
    });
}

function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.staff-list-item:not(.dragging)')];
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) { return { offset: offset, element: child }; } else { return closest; }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// ==========================================
// 5. AUTO-GENERATE 15TH
// ==========================================
function checkAndRunAutoGenerate() {
    if (!globalSettings.pattern || !globalSettings.seedDate || allStaffNames.length === 0) return;
    const [year, month] = currentYearMonth.split('-');
    const selectedDate = new Date(year, parseInt(month)-1, 1);
    const today = new Date();
    const isNextMonth = (selectedDate.getFullYear() === today.getFullYear() && selectedDate.getMonth() === today.getMonth() + 1) || 
                        (selectedDate.getFullYear() === today.getFullYear() + 1 && selectedDate.getMonth() === 0 && today.getMonth() === 11);
                        
    if (isNextMonth && today.getDate() >= 15) {
        const monthHasData = Object.values(localDataCache).some(data => data.date && data.date.startsWith(currentYearMonth) && data.shift !== "");
        if (!monthHasData) { executeAutoGenerateLogic(); }
    }
}

function calculateShift(targetDateStr, team, staffIndex, totalStaffInTeam, settings) {
    const seed = new Date(settings.seedDate);
    const target = new Date(targetDateStr);
    const msPerDay = 1000 * 60 * 60 * 24;
    const daysDiff = Math.floor((Date.UTC(target.getFullYear(), target.getMonth(), target.getDate()) - Date.UTC(seed.getFullYear(), seed.getMonth(), seed.getDate())) / msPerDay);
    const segments = settings.pattern.split('').map(Number);
    const cycleLength = segments.reduce((a, b) => a + b, 0);
    const fullCycles = Math.floor(daysDiff / cycleLength);
    const dayInCycle = ((daysDiff % cycleLength) + cycleLength) % cycleLength;
    
    let daysAccumulated = 0; let currentSegmentIndex = 0;
    for (let i = 0; i < segments.length; i++) {
        if (dayInCycle >= daysAccumulated && dayInCycle < daysAccumulated + segments[i]) { currentSegmentIndex = i; break; }
        daysAccumulated += segments[i];
    }
    
    const isTeamAWork = (currentSegmentIndex % 2 === 0);
    const isWorking = (team === 'A' && isTeamAWork) || (team === 'B' && !isTeamAWork);
    if (!isWorking) return ""; 
    
    let workBlocksInCycle = 0; let myWorkBlockCurrentCycle = 0;
    for (let i = 0; i < segments.length; i++) {
        const isThisSegmentWorkForMe = (team === 'A' && i % 2 === 0) || (team === 'B' && i % 2 !== 0);
        if (isThisSegmentWorkForMe) { workBlocksInCycle++; if (i < currentSegmentIndex) myWorkBlockCurrentCycle++; }
    }
    
    const globalWorkBlockIndex = (fullCycles * workBlocksInCycle) + myWorkBlockCurrentCycle;
    const isTopHalf = staffIndex < Math.ceil(totalStaffInTeam / 2);
    if (globalWorkBlockIndex % 2 === 0) { return isTopHalf ? "AM" : "PM"; } else { return isTopHalf ? "PM" : "AM"; }
}

async function executeAutoGenerateLogic() {
    const [year, month] = currentYearMonth.split('-');
    const totalDays = getDaysInMonth(year, month);
    let batch = writeBatch(db);
    let operationCount = 0;
    customAlert(`System Event: Schedule generation initialized using algorithm pattern [${globalSettings.pattern}] with Public Holiday logic applied.`);

    for (let day = 1; day <= totalDays; day++) {
        let dateStr = `${currentYearMonth}-${day.toString().padStart(2, '0')}`;
        let dateObj = new Date(dateStr);
        let dayOfWeek = dateObj.getDay();
        let isPH = selangorPH[dateStr];

        staffs.OH.forEach(staffName => {
            let shiftVal = "OH";
            if (dayOfWeek === 0 || dayOfWeek === 6) shiftVal = "";
            if (isPH) shiftVal = "PH"; 
            batch.set(doc(db, "schedules", `${staffName}_${dateStr}`), { staff: staffName, date: dateStr, shift: shiftVal }, { merge: true });
            operationCount++;
        });

        staffs.A.forEach((staffName, index) => {
            let shiftVal = calculateShift(dateStr, 'A', index, staffs.A.length, globalSettings);
            batch.set(doc(db, "schedules", `${staffName}_${dateStr}`), { staff: staffName, date: dateStr, shift: shiftVal }, { merge: true });
            operationCount++;
        });

        staffs.B.forEach((staffName, index) => {
            let shiftVal = calculateShift(dateStr, 'B', index, staffs.B.length, globalSettings);
            batch.set(doc(db, "schedules", `${staffName}_${dateStr}`), { staff: staffName, date: dateStr, shift: shiftVal }, { merge: true });
            operationCount++;
        });

        if (operationCount >= 450) { await batch.commit(); batch = writeBatch(db); operationCount = 0; }
    }
    if (operationCount > 0) await batch.commit();
}

// ==========================================
// 6. MAIN UI TABLE GENERATION
// ==========================================
function generateTable() {
    const [year, month] = currentYearMonth.split('-');
    const totalDays = getDaysInMonth(year, month);
    const theadDOM = document.getElementById("scheduleHead");
    const tbody = document.getElementById("scheduleBody");

    let dayRow = `<tr><th rowspan="2">No</th><th rowspan="2" class="col-name-head">NAME</th><th class="col-day-head">DAY</th>`;
    let dateRow = `<tr><th class="col-date-head">DATE</th>`;

    for (let i = 1; i <= totalDays; i++) {
        let dateStrObj = `${currentYearMonth}-${i.toString().padStart(2, '0')}`;
        let dateObj = new Date(dateStrObj);
        let dayStr = daysName[dateObj.getDay()];
        let isPH = selangorPH[dateStrObj];
        let isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;
        
        let headerClass = ""; 
        let phData = "";
        let phIcon = "";

        if (isPH) {
            headerClass = "bg-ph-header ph-hover-cell rounded-t-lg"; 
            phData = `data-phname="${isPH}"`;
            phIcon = `<svg class="w-2.5 h-2.5 text-amber-600 inline-block mb-1 drop-shadow-sm" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>`;
        } else if (isWeekend) {
            headerClass = "bg-weekend-header"; 
        }

        dayRow += `<th class="${headerClass}" ${phData}>${phIcon} ${dayStr}</th>`;
        dateRow += `<th class="${headerClass}" ${phData}>${i}</th>`;
    }
    
    dayRow += `<th rowspan="2">DAY</th><th rowspan="2">On Call<br>Standby</th><th rowspan="2">Sat /<br>Sun</th></tr>`;
    dateRow += `</tr>`;
    theadDOM.innerHTML = dayRow + dateRow;

    let htmlContent = ''; let staffCounter = 1;
    if (staffs.OH.length > 0) {
        htmlContent += `<tr><td colspan="${totalDays + 5}" class="team-header">Office Hour</td></tr>`;
        staffs.OH.forEach(staff => { htmlContent += createStaffRow(staff, staffCounter++, totalDays); });
    }
    if (staffs.A.length > 0) {
        htmlContent += `<tr><td colspan="${totalDays + 5}" class="team-header">Team A</td></tr>`;
        staffs.A.forEach(staff => { htmlContent += createStaffRow(staff, staffCounter++, totalDays); });
    }
    if (staffs.B.length > 0) {
        htmlContent += `<tr><td colspan="${totalDays + 5}" class="team-header">Team B</td></tr>`;
        staffs.B.forEach(staff => { htmlContent += createStaffRow(staff, staffCounter++, totalDays); });
    }

    tbody.innerHTML = htmlContent;

    const tableContainer = document.getElementById("scheduleTable").parentElement;
    tableContainer.classList.remove('animate-marshmallow');
    void tableContainer.offsetWidth;
    tableContainer.classList.add('animate-marshmallow');

    attachEventListeners();
    updateAllTotals();
    applyCachedDataToUI();
    checkAndRunAutoGenerate();
}

function createStaffRow(staffName, no, totalDays) {
    let row = `<tr><td class="font-semibold text-slate-400">${no}</td><td class="col-staff-name text-slate-700">${staffName}</td><td class="col-shift-label">SHIFT</td>`;
    for (let day = 1; day <= totalDays; day++) {
        let dateKey = `${currentYearMonth}-${day.toString().padStart(2, '0')}`;
        row += `<td><div class="shift-cell shift-" data-staff="${staffName}" data-date="${dateKey}" data-val="">-</div></td>`;
    }
    row += `<td class="total-days font-black text-blue-700" id="total-${staffName}">0</td>
            <td class="col-standby-label text-slate-500 font-semibold">ALL PERSON<br>STANDBY</td>
            <td id="weekend-${staffName}" class="font-extrabold text-amber-600">-</td></tr>`;
    return row;
}

// ==========================================
// 7. EVENT LISTENERS & FLOATING MENU
// ==========================================
let activeShiftCell = null;

function initShiftMenu() {
    const grid = document.getElementById('shiftMenuGrid');
    grid.innerHTML = '';
    
    let btnEmpty = document.createElement('button');
    btnEmpty.className = `shift- hover:scale-105 transition-transform cursor-pointer w-full h-10 rounded-xl text-xs font-black shadow-sm border border-slate-200 text-slate-500 bg-slate-50 hover:bg-slate-100`;
    btnEmpty.innerText = "CLEAR (-)";
    btnEmpty.onclick = () => selectShiftValue("");
    grid.appendChild(btnEmpty);

    shiftOptions.forEach(opt => {
        if(!opt) return;
        let displayOpt = opt;
        if (opt === "AM-OT") displayOpt = "AM";
        if (opt === "PM-OT") displayOpt = "PM";

        let btn = document.createElement('button');
        btn.className = `shift-${opt} hover:scale-105 transition-transform cursor-pointer w-full h-10 rounded-xl text-xs font-black shadow-sm border border-white/60`;
        btn.innerText = displayOpt;
        btn.onclick = () => selectShiftValue(opt);
        grid.appendChild(btn);
    });
}

document.addEventListener('click', (e) => {
    const menu = document.getElementById('customShiftMenu');
    if (menu && !menu.contains(e.target) && !e.target.classList.contains('shift-cell')) {
        closeShiftMenu();
    }
});

function closeShiftMenu() {
    const menu = document.getElementById('customShiftMenu');
    if(!menu) return;
    menu.classList.add('opacity-0', 'scale-95', 'pointer-events-none');
    menu.classList.remove('opacity-100', 'scale-100', 'pointer-events-auto');
    activeShiftCell = null;
    setTimeout(() => menu.classList.add('hidden'), 200);
}

async function selectShiftValue(shiftVal) {
    if(!activeShiftCell) return;
    const staff = activeShiftCell.dataset.staff;
    const date = activeShiftCell.dataset.date;
    
    activeShiftCell.dataset.val = shiftVal;
    activeShiftCell.className = `shift-cell shift-${shiftVal}`;
    
    let displayVal = shiftVal || "-";
    if(shiftVal === "AM-OT") displayVal = "AM";
    if(shiftVal === "PM-OT") displayVal = "PM";
    activeShiftCell.innerText = displayVal;

    closeShiftMenu();
    calculateStaffStats(staff);

    try { await setDoc(doc(db, "schedules", `${staff}_${date}`), { staff, date, shift: shiftVal }, { merge: true }); } 
    catch (error) { console.error(error); }
}

function attachEventListeners() {
    // 1. SHIFT CELL CLICK
    document.querySelectorAll('.shift-cell').forEach(cell => {
        cell.addEventListener('click', (e) => {
            activeShiftCell = cell;
            const menu = document.getElementById('customShiftMenu');
            if(!menu) return;
            menu.classList.remove('hidden');
            
            const rect = cell.getBoundingClientRect();
            let top = rect.bottom + window.scrollY + 8;
            let left = rect.left + window.scrollX;
            
            if (left + 280 > window.innerWidth) { left = window.innerWidth - 290; }
            if (top + 250 > window.innerHeight + window.scrollY) { top = rect.top + window.scrollY - 260; }

            menu.style.top = `${top}px`;
            menu.style.left = `${left}px`;
            
            setTimeout(() => {
                menu.classList.remove('opacity-0', 'scale-95', 'pointer-events-none');
                menu.classList.add('opacity-100', 'scale-100', 'pointer-events-auto');
            }, 10);
        });
    });

    // 2. PH HOVER TOOLTIP
    const phTooltip = document.getElementById('phTooltip');
    if(phTooltip) {
        document.querySelectorAll('.ph-hover-cell').forEach(cell => {
            cell.addEventListener('mouseenter', (e) => {
                const phName = e.target.getAttribute('data-phname');
                phTooltip.innerHTML = `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg> ${phName}`;
                phTooltip.classList.remove('hidden');
            });
            
            cell.addEventListener('mousemove', (e) => {
                phTooltip.style.left = `${e.pageX}px`;
                phTooltip.style.top = `${e.pageY - 15}px`;
            });
            
            cell.addEventListener('mouseleave', () => {
                phTooltip.classList.add('hidden');
            });
        });
    }
}

// ==========================================
// 8. FIREBASE SYNC & CALCULATIONS
// ==========================================
function calculateStaffStats(staffName) {
    const cells = document.querySelectorAll(`.shift-cell[data-staff="${staffName}"]`);
    let totalWorked = 0; let workedDates = new Set(); 
    cells.forEach(cell => {
        const val = cell.dataset.val;
        if (!val) return;
        if (["OH", "AM", "PM", "AM-OT", "PM-OT"].includes(val)) { totalWorked++; workedDates.add(cell.dataset.date); }
    });

    let fullWeekendsWorked = 0;
    const [year, month] = currentYearMonth.split('-');
    const totalDays = getDaysInMonth(year, month);
    for (let day = 1; day <= totalDays; day++) {
        let currentDayStr = `${currentYearMonth}-${day.toString().padStart(2, '0')}`;
        let dateObj = new Date(currentDayStr);
        if (dateObj.getDay() === 6) { 
            let nextDay = day + 1;
            if (nextDay <= totalDays) { 
                let sunDateStr = `${currentYearMonth}-${nextDay.toString().padStart(2, '0')}`;
                if (workedDates.has(currentDayStr) && workedDates.has(sunDateStr)) { fullWeekendsWorked++; }
            }
        }
    }

    const totalEl = document.getElementById(`total-${staffName}`);
    const weekendEl = document.getElementById(`weekend-${staffName}`);
    if (totalEl) totalEl.innerText = totalWorked;
    if (weekendEl) weekendEl.innerText = fullWeekendsWorked > 0 ? `${fullWeekendsWorked} weekend${fullWeekendsWorked > 1 ? 's' : ''}` : "0 weekend";
}

function updateAllTotals() { allStaffNames.forEach(staff => calculateStaffStats(staff)); }

function applyCachedDataToUI() {
    Object.keys(localDataCache).forEach(docId => {
        const data = localDataCache[docId];
        if (data.date && data.date.startsWith(currentYearMonth)) {
            const cellEl = document.querySelector(`.shift-cell[data-staff="${data.staff}"][data-date="${data.date}"]`);
            if (cellEl) { 
                cellEl.dataset.val = data.shift; 
                cellEl.className = `shift-cell shift-${data.shift}`;
                let displayVal = data.shift || "-";
                if(data.shift === "AM-OT") displayVal = "AM";
                if(data.shift === "PM-OT") displayVal = "PM";
                cellEl.innerText = displayVal;
            }
        }
    });
    updateAllTotals();
}

function listenToSchedules() {
    onSnapshot(collection(db, "schedules"), (snapshot) => {
        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            localDataCache[docSnap.id] = data;
            if (data.date && data.date.startsWith(currentYearMonth)) {
                const cellEl = document.querySelector(`.shift-cell[data-staff="${data.staff}"][data-date="${data.date}"]`);
                if (cellEl && cellEl.dataset.val !== data.shift) {
                    cellEl.dataset.val = data.shift; 
                    cellEl.className = `shift-cell shift-${data.shift}`;
                    let displayVal = data.shift || "-";
                    if(data.shift === "AM-OT") displayVal = "AM";
                    if(data.shift === "PM-OT") displayVal = "PM";
                    cellEl.innerText = displayVal;
                }
            }
        });
        updateAllTotals();
        checkAndRunAutoGenerate();
    });
}

// ==========================================
// 9. IMPORT EXCEL
// ==========================================
if(document.getElementById('excelUpload')){
    document.getElementById('excelUpload').addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        const labelText = document.getElementById('uploadLabelText');
        const originalText = labelText.innerHTML;
        labelText.innerHTML = "Processing Data...";

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = window.XLSX.read(data, { type: 'array' });
                const currentSelectedYear = currentYearMonth.split('-')[0];
                const monthKeywords = [ { key: "JAN", num: "01" }, { key: "FEB", num: "02" }, { key: "MAR", num: "03" }, { key: "APR", num: "04" }, { key: "MAY", num: "05" }, { key: "JUN", num: "06" }, { key: "JUL", num: "07" }, { key: "AUG", num: "08" }, { key: "SEP", num: "09" }, { key: "OCT", num: "10" }, { key: "NOV", num: "11" }, { key: "DEC", num: "12" } ];

                let batches = []; let currentBatch = writeBatch(db);
                let operationCount = 0; let totalCommitCount = 0;

                for (let sheetName of workbook.SheetNames) {
                    const sheetNameUpper = sheetName.toUpperCase();
                    let matchedMonth = monthKeywords.find(m => sheetNameUpper.includes(m.key));
                    if (!matchedMonth) continue; 
                    let sheetYear = currentSelectedYear; let yearMatch = sheetNameUpper.match(/\d{4}/); if (yearMatch) sheetYear = yearMatch[0];
                    const yearMonthStr = `${sheetYear}-${matchedMonth.num}`;
                    const totalDaysInSheet = getDaysInMonth(sheetYear, matchedMonth.num);
                    const jsonData = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });

                    let dayColMap = {};
                    for (let r = 0; r < Math.min(20, jsonData.length); r++) {
                        let row = jsonData[r]; if (!row) continue;
                        let daysFound = 0; let tempMap = {};
                        for (let c = 0; c < row.length; c++) {
                            if (row[c] && !isNaN(row[c])) { let num = parseInt(row[c]); if (num >= 1 && num <= 31) { tempMap[num] = c; daysFound++; } }
                        }
                        if (daysFound >= 28) { dayColMap = tempMap; break; }
                    }
                    if (Object.keys(dayColMap).length === 0) continue; 

                    for (let r = 0; r < jsonData.length; r++) {
                        const row = jsonData[r]; if (!row || !Array.isArray(row)) continue;
                        let staffName = null;
                        for (let c = 0; c < row.length; c++) {
                            if (row[c]) { let cellVal = String(row[c]).toUpperCase().replace(/\s+/g, ' ').trim(); if (allStaffNames.includes(cellVal)) { staffName = cellVal; break; } }
                        }
                        if (staffName) {
                            for (let day = 1; day <= totalDaysInSheet; day++) {
                                let colIdx = dayColMap[day];
                                if (colIdx !== undefined) {
                                    let shiftVal = row[colIdx] ? String(row[colIdx]).toUpperCase().trim() : "";
                                    if (!shiftOptions.includes(shiftVal)) shiftVal = "";
                                    let dateStr = `${yearMonthStr}-${day.toString().padStart(2, '0')}`;
                                    currentBatch.set(doc(db, "schedules", `${staffName}_${dateStr}`), { staff: staffName, date: dateStr, shift: shiftVal }, { merge: true });
                                    operationCount++; totalCommitCount++;
                                    if (operationCount >= 450) { batches.push(currentBatch); currentBatch = writeBatch(db); operationCount = 0; }
                                }
                            }
                        }
                    }
                }
                if (operationCount > 0) batches.push(currentBatch);
                if (batches.length > 0) {
                    labelText.innerHTML = `Commit: ${totalCommitCount} Records`;
                    try {
                        for (let b of batches) { await b.commit(); }
                        labelText.innerHTML = `Import Successful`; customAlert(`Data processing complete. Successfully saved ${totalCommitCount} records.`);
                    } catch (err) { labelText.innerHTML = "Import Failed"; customAlert(`System Error: ${err.message}`); } 
                    finally { setTimeout(() => { labelText.innerHTML = originalText; }, 5000); }
                } else { customAlert("No valid shift patterns detected in document."); labelText.innerHTML = originalText; }
            } catch (error) { customAlert("Fatal Error: Could not read Document stream."); labelText.innerHTML = originalText; } 
            finally { event.target.value = ''; }
        };
        reader.readAsArrayBuffer(file);
    });
}

// ==========================================
// 10. INITIALIZE APP
// ==========================================
window.onload = () => {
    updateMonthDisplayUI();
    initShiftMenu();
    listenToSettings(); 
    listenToStaffList(); 
    listenToSchedules();
};