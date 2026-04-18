/* =============================================================================
 * 🎨 FRONTEND — Lógica de la UI (vanilla JS, sin dependencias)
 * =============================================================================
 *
 * Este archivo controla el flujo de la página:
 *   1. Carga la configuración pública desde /api/config
 *   2. Pinta el calendario
 *   3. Al elegir día → pide slots a /api/availability
 *   4. Al confirmar → POST a /api/reservation
 *
 * ✏️  Puedes modificar la UX (animaciones, orden, pasos), pero
 *     mantén las llamadas a /api/* igual.
 *
 * ========================================================================== */

let CONFIG = null;           // cache de /api/config
let state = {
  date: null,                // YYYY-MM-DD seleccionada
  time: null,                // HH:MM seleccionada
  serviceId: null,           // servicio (si aplica)
  currentMonth: new Date(),  // mes visible en calendario
};

/* ========== INIT ========== */
(async function init() {
  try {
    const res = await fetch("/api/config");
    CONFIG = await res.json();
  } catch (e) {
    document.body.innerHTML = "<p style='padding:40px;text-align:center'>Error cargando configuración.</p>";
    return;
  }
  applyConfig();
  renderServices();
  renderCalendar();
  bindForm();
})();

/* ========== APPLY CONFIG A LA UI ========== */
function applyConfig() {
  // Color principal
  document.documentElement.style.setProperty("--primary", CONFIG.business.primaryColor);

  // Textos
  document.title = `Reservas — ${CONFIG.business.name}`;
  document.getElementById("businessName").textContent = CONFIG.business.name;
  document.getElementById("businessTagline").textContent = CONFIG.business.tagline || "";

  // Sustituir textos i18n marcados con data-txt
  const txt = CONFIG.ui?.texts || {};
  document.querySelectorAll("[data-txt]").forEach((el) => {
    const key = el.getAttribute("data-txt");
    if (txt[key]) el.textContent = txt[key];
  });

  // Mostrar/ocultar campos opcionales
  if (!CONFIG.booking.requirePhone) {
    document.querySelector('input[name="phone"]').removeAttribute("required");
  }
  if (CONFIG.booking.requireNotes) {
    document.getElementById("notesLabel").classList.remove("hidden");
  }
}

/* ========== SERVICIOS ========== */
function renderServices() {
  const services = CONFIG.services || [];
  if (services.length <= 1) {
    if (services.length === 1) state.serviceId = services[0].id;
    return;
  }
  const step = document.getElementById("serviceStep");
  const list = document.getElementById("serviceList");
  step.classList.remove("hidden");

  list.innerHTML = services.map((s) => `
    <button class="service-btn" data-id="${s.id}">
      <span><b>${s.name}</b><br><small class="muted">${s.duration} min</small></span>
      ${s.price ? `<span class="price">${s.price} €</span>` : ""}
    </button>
  `).join("");

  list.querySelectorAll(".service-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      list.querySelectorAll(".service-btn").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      state.serviceId = btn.dataset.id;
      if (state.date) loadSlots();  // si ya había fecha, recargamos
    });
  });
}

/* ========== CALENDARIO ========== */
function renderCalendar() {
  const cal = document.getElementById("calendar");
  const d = state.currentMonth;
  const year = d.getFullYear();
  const month = d.getMonth();
  const monthName = d.toLocaleDateString(CONFIG.ui.locale || "es", { month: "long", year: "numeric" });

  const first = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0).getDate();
  const startDow = (first.getDay() + 6) % 7; // lunes=0

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const maxDate = new Date(today);
  maxDate.setDate(maxDate.getDate() + (CONFIG.booking.maxAdvanceDays || 30));

  const scheduleKeys = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];

  let html = `
    <div class="cal-nav">
      <button id="prevMonth">‹</button>
      <strong>${monthName}</strong>
      <button id="nextMonth">›</button>
    </div>
    ${["L","M","X","J","V","S","D"].map((x) => `<div class="cal-dow">${x}</div>`).join("")}
  `;
  for (let i = 0; i < startDow; i++) html += `<div></div>`;

  for (let day = 1; day <= lastDay; day++) {
    const date = new Date(year, month, day);
    const iso = toISO(date);
    const dowKey = scheduleKeys[(date.getDay() + 6) % 7];
    const isPast = date < today;
    const isFuture = date > maxDate;
    const isClosed = CONFIG.schedule[dowKey]?.closed;
    const disabled = isPast || isFuture || isClosed;
    const isToday = iso === toISO(today);
    const selected = iso === state.date;

    html += `<div class="cal-day ${disabled ? "disabled" : ""} ${isToday ? "today" : ""} ${selected ? "selected" : ""}"
              data-date="${iso}">${day}</div>`;
  }
  cal.innerHTML = html;

  cal.querySelector("#prevMonth").onclick = () => {
    state.currentMonth = new Date(year, month - 1, 1);
    renderCalendar();
  };
  cal.querySelector("#nextMonth").onclick = () => {
    state.currentMonth = new Date(year, month + 1, 1);
    renderCalendar();
  };
  cal.querySelectorAll(".cal-day:not(.disabled)").forEach((cell) => {
    cell.addEventListener("click", () => {
      state.date = cell.dataset.date;
      state.time = null;
      renderCalendar();
      loadSlots();
    });
  });
}

/* ========== SLOTS ========== */
async function loadSlots() {
  const step = document.getElementById("timeStep");
  const container = document.getElementById("timeSlots");
  step.classList.remove("hidden");
  container.innerHTML = "<p class='muted'>Cargando…</p>";

  const url = `/api/availability?date=${state.date}${state.serviceId ? "&service=" + state.serviceId : ""}`;
  try {
    const res = await fetch(url);
    const data = await res.json();

    if (!data.slots || data.slots.length === 0) {
      container.innerHTML = `<p class='muted'>${CONFIG.ui.texts.noSlotsAvailable}</p>`;
      document.getElementById("detailsStep").classList.add("hidden");
      return;
    }

    container.innerHTML = data.slots.map((s) => `
      <button class="slot-btn" data-time="${s.start}" ${s.available ? "" : "disabled"}>
        ${s.start}
      </button>
    `).join("");

    container.querySelectorAll(".slot-btn:not(:disabled)").forEach((btn) => {
      btn.addEventListener("click", () => {
        container.querySelectorAll(".slot-btn").forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        state.time = btn.dataset.time;
        document.getElementById("detailsStep").classList.remove("hidden");
      });
    });
  } catch (e) {
    container.innerHTML = "<p class='muted'>Error cargando horas.</p>";
  }
}

/* ========== FORMULARIO ========== */
function bindForm() {
  const form = document.getElementById("bookingForm");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!state.date || !state.time) {
      alert("Selecciona fecha y hora");
      return;
    }
    const btn = document.getElementById("confirmBtn");
    btn.disabled = true;
    btn.textContent = "Enviando…";

    const fd = new FormData(form);
    const payload = {
      date: state.date,
      startTime: state.time,
      serviceId: state.serviceId,
      name: fd.get("name"),
      email: fd.get("email"),
      phone: fd.get("phone"),
      notes: fd.get("notes"),
    };

    try {
      const res = await fetch("/api/reservation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      const result = document.getElementById("result");
      result.classList.remove("hidden");

      if (data.success) {
        result.className = "result success";
        result.innerHTML = `<h3>${CONFIG.ui.texts.successTitle}</h3><p>${CONFIG.ui.texts.successMessage}</p>`;
        form.reset();
      } else {
        result.className = "result error";
        const msg = data.error === "SLOT_TAKEN"
          ? CONFIG.ui.texts.errorSlotTaken
          : (data.error || CONFIG.ui.texts.errorGeneric);
        result.innerHTML = `<h3>⚠️ ${msg}</h3>`;
        if (data.error === "SLOT_TAKEN") loadSlots();
      }
      result.scrollIntoView({ behavior: "smooth" });
    } catch (err) {
      alert(CONFIG.ui.texts.errorGeneric);
    } finally {
      btn.disabled = false;
      btn.textContent = CONFIG.ui.texts.confirmButton;
    }
  });
}

/* ========== HELPERS ========== */
function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
