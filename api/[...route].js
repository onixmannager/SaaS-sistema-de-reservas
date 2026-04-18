// api/[...route].js
// ============================================================
// SISTEMA DE RESERVAS COMPLETO - CON CONFIGURACIÓN AUTOMÁTICA
// ============================================================
// Al primer uso crea la configuración por defecto en Firestore.
// Incluye página /admin/config para editar todo visualmente.
// ============================================================

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { Resend } from 'resend';

// ========== CONFIGURACIÓN FIREBASE ==========
const firebaseConfig = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
};

let db;
function getDb() {
  if (!db) {
    const app = initializeApp({
      credential: cert(firebaseConfig),
      projectId: firebaseConfig.projectId,
    }, 'admin');
    db = getFirestore(app);
  }
  return db;
}

// Configuración por defecto (se usará si no existe en Firestore)
const DEFAULT_CONFIG = {
  name: "Mi Negocio",
  tagline: "Reserva tu cita fácilmente",
  primaryColor: "#0066F0",
  location: "Online",
  schedule: {
    monday:    { start: "09:00", end: "17:00", closed: false },
    tuesday:   { start: "09:00", end: "17:00", closed: false },
    wednesday: { start: "09:00", end: "17:00", closed: false },
    thursday:  { start: "09:00", end: "17:00", closed: false },
    friday:    { start: "09:00", end: "15:00", closed: false },
    saturday:  { closed: true },
    sunday:    { closed: true }
  },
  booking: {
    slotDuration: 30,
    minAdvanceHours: 1,
    maxAdvanceDays: 60
  }
};

const DEFAULT_SERVICES = [
  { id: 'sv1', name: 'Consultoría', duration: 30, priceFormatted: '50€', active: true, order: 1 }
];

// ========== FUNCIONES AUXILIARES ==========
async function ensureConfigExists() {
  const db = getDb();
  const configRef = db.collection('business').doc('config');
  const configDoc = await configRef.get();
  
  if (!configDoc.exists) {
    await configRef.set(DEFAULT_CONFIG);
    console.log('✅ Configuración por defecto creada');
  }
  
  const servicesRef = db.collection('services');
  const servicesSnap = await servicesRef.where('active', '==', true).get();
  if (servicesSnap.empty) {
    const batch = db.batch();
    DEFAULT_SERVICES.forEach(svc => {
      const docRef = servicesRef.doc(svc.id);
      batch.set(docRef, svc);
    });
    await batch.commit();
    console.log('✅ Servicios por defecto creados');
  }
}

function generateSlots(start, end, duration, bookedSlots, buffer = 0) {
  const slots = [];
  let current = start;
  while (current + duration <= end) {
    const slotStart = current;
    const slotEnd = current + duration;
    const isAvailable = !bookedSlots.some(booking => {
      const bookingEnd = booking.start + booking.duration;
      return (slotStart < bookingEnd + buffer && slotEnd > booking.start - buffer);
    });
    slots.push({
      start: `${String(Math.floor(slotStart / 60)).padStart(2, '0')}:${String(slotStart % 60).padStart(2, '0')}`,
      available: isAvailable
    });
    current += duration;
  }
  return slots;
}

// ========== HTMLs ==========
const landingHTML = `...`; // (el mismo HTML de antes, sin cambios)

const adminHTML = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin · Panel de Reservas</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Inter',sans-serif;background:#F3F4F6;padding:20px}
    .container{max-width:1200px;margin:0 auto}
    h1{font-size:28px;margin-bottom:8px}
    .nav{display:flex;gap:20px;margin-bottom:20px}
    .nav a{text-decoration:none;padding:8px 16px;background:#E5E7EB;border-radius:8px;color:#1F2937}
    .nav a.active{background:#0066F0;color:white}
    table{width:100%;background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,0.1)}
    th{background:#1F2937;color:white;padding:12px;text-align:left}
    td{padding:12px;border-bottom:1px solid #E5E7EB}
    .badge{padding:4px 8px;border-radius:20px;font-size:12px;font-weight:600}
    .confirmed{background:#D1FAE5;color:#065F46}
    .cancelled{background:#FEE2E2;color:#991B1B}
    .btn{padding:8px 16px;border:none;border-radius:6px;cursor:pointer;margin-right:8px}
    .btn-edit{background:#0066F0;color:white}
    .btn-cancel{background:#EF4444;color:white}
    .btn-save{background:#10B981;color:white;padding:12px 24px}
    input,select,textarea{padding:10px;border:1px solid #D1D5DB;border-radius:8px;width:100%}
    .form-group{margin-bottom:16px}
    .day-row{display:grid;grid-template-columns:100px 1fr;gap:10px;align-items:center}
  </style>
</head>
<body>
<div class="container">
  <h1>📋 Panel de Administración</h1>
  <div class="nav">
    <a href="#" class="active" data-page="reservations">Reservas</a>
    <a href="#" data-page="config">Configuración</a>
  </div>
  
  <!-- Página de Reservas -->
  <div id="pageReservations">
    <div style="display:flex;gap:20px;margin:20px 0">
      <input type="text" id="search" placeholder="Buscar por nombre o email...">
      <select id="filterStatus" style="width:auto">
        <option value="">Todos</option>
        <option value="confirmed">Confirmadas</option>
        <option value="pending">Pendientes</option>
        <option value="cancelled">Canceladas</option>
      </select>
      <button class="btn btn-edit" onclick="loadReservations()">Actualizar</button>
    </div>
    <div style="overflow-x:auto">
      <table id="reservationsTable">
        <thead><tr><th>Cliente</th><th>Servicio</th><th>Fecha/Hora</th><th>Estado</th><th>Acciones</th></tr></thead>
        <tbody id="tbody"></tbody>
      </table>
    </div>
  </div>
  
  <!-- Página de Configuración -->
  <div id="pageConfig" style="display:none">
    <h2>Configuración del Negocio</h2>
    <div style="background:white;padding:24px;border-radius:12px;margin-top:20px">
      <div class="form-group">
        <label>Nombre del negocio</label>
        <input type="text" id="cfgName">
      </div>
      <div class="form-group">
        <label>Eslogan</label>
        <input type="text" id="cfgTagline">
      </div>
      <div class="form-group">
        <label>Color principal</label>
        <input type="color" id="cfgColor" style="width:100px;height:40px">
      </div>
      <div class="form-group">
        <label>Ubicación / Enlace</label>
        <input type="text" id="cfgLocation">
      </div>
      <h3>Horario semanal</h3>
      <div id="scheduleEditor"></div>
      <h3>Servicios</h3>
      <div id="servicesEditor"></div>
      <button class="btn-save" onclick="saveConfig()">Guardar cambios</button>
    </div>
  </div>
</div>

<script>
  const ADMIN_KEY = localStorage.getItem('admin_key') || prompt('Clave de administrador:');
  localStorage.setItem('admin_key', ADMIN_KEY);
  
  let allReservations = [];
  let businessConfig = null;
  
  // Navegación
  document.querySelectorAll('[data-page]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      document.querySelectorAll('[data-page]').forEach(l => l.classList.remove('active'));
      link.classList.add('active');
      const page = link.dataset.page;
      document.getElementById('pageReservations').style.display = page === 'reservations' ? 'block' : 'none';
      document.getElementById('pageConfig').style.display = page === 'config' ? 'block' : 'none';
      if (page === 'config') loadConfig();
    });
  });
  
  async function loadReservations() {
    const res = await fetch('/api/admin/reservations', {
      headers: {'Authorization': 'Bearer ' + ADMIN_KEY}
    });
    const data = await res.json();
    allReservations = data.reservations || [];
    renderTable();
  }
  
  function renderTable() {
    const search = document.getElementById('search').value.toLowerCase();
    const status = document.getElementById('filterStatus').value;
    let filtered = allReservations.filter(r => {
      const matchSearch = !search || r.customer.name.toLowerCase().includes(search) || r.customer.email.toLowerCase().includes(search);
      const matchStatus = !status || r.status === status;
      return matchSearch && matchStatus;
    });
    const tbody = document.getElementById('tbody');
    tbody.innerHTML = filtered.map(r => \`
      <tr>
        <td><strong>\${r.customer.name}</strong><br><small>\${r.customer.email}</small></td>
        <td>\${r.serviceName}</td>
        <td>\${r.date} \${r.time}</td>
        <td><span class="badge \${r.status}">\${r.status}</span></td>
        <td>
          <button class="btn btn-edit" onclick="editReservation('\${r.id}')">Editar</button>
          <button class="btn btn-cancel" onclick="cancelReservation('\${r.id}')">Cancelar</button>
        </td>
      </tr>
    \`).join('');
  }
  
  async function cancelReservation(id) {
    if (!confirm('¿Cancelar esta reserva?')) return;
    await fetch(\`/api/admin/reservations/\${id}/cancel\`, {
      method: 'POST',
      headers: {'Authorization': 'Bearer ' + ADMIN_KEY, 'Content-Type': 'application/json'},
      body: JSON.stringify({reason: 'Cancelado por administrador'})
    });
    loadReservations();
  }
  
  async function editReservation(id) {
    const r = allReservations.find(r => r.id === id);
    const newDate = prompt('Nueva fecha (YYYY-MM-DD):', r.date);
    const newTime = prompt('Nueva hora (HH:MM):', r.time);
    if (newDate && newTime) {
      await fetch(\`/api/admin/reservations/\${id}\`, {
        method: 'PUT',
        headers: {'Authorization': 'Bearer ' + ADMIN_KEY, 'Content-Type': 'application/json'},
        body: JSON.stringify({date: newDate, time: newTime})
      });
      loadReservations();
    }
  }
  
  async function loadConfig() {
    const res = await fetch('/api/config');
    businessConfig = await res.json();
    document.getElementById('cfgName').value = businessConfig.business.name;
    document.getElementById('cfgTagline').value = businessConfig.business.tagline;
    document.getElementById('cfgColor').value = businessConfig.business.primaryColor;
    document.getElementById('cfgLocation').value = businessConfig.business.location;
    renderScheduleEditor();
    renderServicesEditor();
  }
  
  function renderScheduleEditor() {
    const days = ['lunes','martes','miércoles','jueves','viernes','sábado','domingo'];
    const keys = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
    const schedule = businessConfig.schedule;
    let html = '';
    days.forEach((day, i) => {
      const key = keys[i];
      const dayData = schedule[key] || { closed: true, start: '09:00', end: '17:00' };
      html += \`<div class="day-row">
        <label><input type="checkbox" data-day="\${key}" \${dayData.closed ? '' : 'checked'}> \${day}</label>
        <div>
          <input type="time" data-start="\${key}" value="\${dayData.start || '09:00'}" \${dayData.closed ? 'disabled' : ''}>
          <input type="time" data-end="\${key}" value="\${dayData.end || '17:00'}" \${dayData.closed ? 'disabled' : ''}>
        </div>
      </div>\`;
    });
    document.getElementById('scheduleEditor').innerHTML = html;
    document.querySelectorAll('[data-day]').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const day = e.target.dataset.day;
        const start = document.querySelector(\`[data-start="\${day}"]\`);
        const end = document.querySelector(\`[data-end="\${day}"]\`);
        start.disabled = !e.target.checked;
        end.disabled = !e.target.checked;
      });
    });
  }
  
  function renderServicesEditor() {
    const services = businessConfig.services;
    let html = '<div id="servicesList">';
    services.forEach((s, idx) => {
      html += \`<div style="border:1px solid #ddd;padding:12px;margin-bottom:8px;border-radius:8px">
        <input value="\${s.name}" data-service-name="\${idx}" placeholder="Nombre" style="width:200px">
        <input value="\${s.duration}" data-service-duration="\${idx}" type="number" placeholder="Duración (min)" style="width:100px">
        <input value="\${s.priceFormatted}" data-service-price="\${idx}" placeholder="Precio" style="width:100px">
        <label><input type="checkbox" data-service-active="\${idx}" \${s.active ? 'checked' : ''}> Activo</label>
        <button onclick="removeService(\${idx})">Eliminar</button>
      </div>\`;
    });
    html += '</div><button onclick="addService()">+ Añadir servicio</button>';
    document.getElementById('servicesEditor').innerHTML = html;
  }
  
  window.addService = function() {
    businessConfig.services.push({ name: 'Nuevo servicio', duration: 30, priceFormatted: '0€', active: true });
    renderServicesEditor();
  };
  
  window.removeService = function(idx) {
    businessConfig.services.splice(idx, 1);
    renderServicesEditor();
  };
  
  async function saveConfig() {
    const newConfig = {
      business: {
        name: document.getElementById('cfgName').value,
        tagline: document.getElementById('cfgTagline').value,
        primaryColor: document.getElementById('cfgColor').value,
        location: document.getElementById('cfgLocation').value
      },
      schedule: {},
      services: []
    };
    // Recoger horario
    const days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
    days.forEach(day => {
      const cb = document.querySelector(\`[data-day="\${day}"]\`);
      const start = document.querySelector(\`[data-start="\${day}"]\`);
      const end = document.querySelector(\`[data-end="\${day}"]\`);
      newConfig.schedule[day] = {
        closed: !cb.checked,
        start: start.value,
        end: end.value
      };
    });
    // Servicios
    document.querySelectorAll('[data-service-name]').forEach(el => {
      const idx = el.dataset.serviceName;
      const name = el.value;
      const duration = document.querySelector(\`[data-service-duration="\${idx}"]\`).value;
      const price = document.querySelector(\`[data-service-price="\${idx}"]\`).value;
      const active = document.querySelector(\`[data-service-active="\${idx}"]\`).checked;
      newConfig.services.push({ name, duration: parseInt(duration), priceFormatted: price, active });
    });
    
    const res = await fetch('/api/admin/config', {
      method: 'POST',
      headers: {'Authorization': 'Bearer ' + ADMIN_KEY, 'Content-Type': 'application/json'},
      body: JSON.stringify(newConfig)
    });
    if (res.ok) {
      alert('Configuración guardada');
    } else {
      alert('Error al guardar');
    }
  }
  
  document.getElementById('search').addEventListener('input', renderTable);
  document.getElementById('filterStatus').addEventListener('change', renderTable);
  
  loadReservations();
</script>
</body>
</html>`;

// ========== HANDLER PRINCIPAL ==========
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const path = req.query.route || [];
  const route = '/' + path.join('/');

  // Asegurar que existe la configuración en Firestore
  await ensureConfigExists();

  // ========== API ROUTES ==========
  
  // GET /api/config
  if (req.method === 'GET' && route === '/config') {
    const db = getDb();
    const businessDoc = await db.collection('business').doc('config').get();
    const business = businessDoc.data();
    const servicesSnap = await db.collection('services').where('active', '==', true).get();
    const services = servicesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    return res.json({
      business,
      services: services.length ? services : DEFAULT_SERVICES,
      schedule: business.schedule,
      booking: business.booking,
      ui: { locale: 'es', texts: {} }
    });
  }

  // GET /api/availability
  if (req.method === 'GET' && route === '/availability') {
    const { date, service } = req.query;
    if (!date) return res.status(400).json({ error: 'Fecha requerida' });
    const db = getDb();
    const businessDoc = await db.collection('business').doc('config').get();
    const business = businessDoc.data();
    const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const selectedDate = new Date(date);
    const daySchedule = business.schedule[dayNames[selectedDate.getDay()]] || { closed: true };
    if (daySchedule.closed) return res.json({ slots: [] });
    let duration = business.booking.slotDuration;
    if (service) {
      const svc = await db.collection('services').doc(service).get();
      if (svc.exists) duration = svc.data().duration;
    }
    const [startH, startM] = daySchedule.start.split(':').map(Number);
    const [endH, endM] = daySchedule.end.split(':').map(Number);
    const start = startH * 60 + startM;
    const end = endH * 60 + endM;
    const bookingsSnap = await db.collection('reservations')
      .where('date', '==', date)
      .where('status', 'in', ['confirmed', 'pending']).get();
    const booked = bookingsSnap.docs.map(d => {
      const b = d.data();
      const [h, m] = b.time.split(':').map(Number);
      return { start: h * 60 + m, duration: b.serviceDuration || duration };
    });
    const slots = generateSlots(start, end, duration, booked, 0);
    return res.json({ slots });
  }

  // POST /api/reservation
  if (req.method === 'POST' && route === '/reservation') {
    const { date, startTime, serviceId, name, email, phone, notes } = req.body;
    if (!date || !startTime || !serviceId || !name || !email) {
      return res.status(400).json({ success: false, error: 'Faltan campos' });
    }
    const db = getDb();
    const businessDoc = await db.collection('business').doc('config').get();
    const business = businessDoc.data();
    const serviceDoc = await db.collection('services').doc(serviceId).get();
    const service = serviceDoc.data();
    const duration = service?.duration || 30;
    const [slotH, slotM] = startTime.split(':').map(Number);
    const slotStart = slotH * 60 + slotM;
    const slotEnd = slotStart + duration;
    const existing = await db.collection('reservations')
      .where('date', '==', date)
      .where('status', 'in', ['confirmed', 'pending']).get();
    const conflict = existing.docs.some(d => {
      const b = d.data();
      const [h, m] = b.time.split(':').map(Number);
      const bStart = h * 60 + m;
      const bEnd = bStart + (b.serviceDuration || duration);
      return slotStart < bEnd && slotEnd > bStart;
    });
    if (conflict) return res.status(409).json({ success: false, error: 'SLOT_TAKEN' });
    const reservation = {
      date, time: startTime,
      serviceId, serviceName: service.name, serviceDuration: duration,
      customer: { name, email, phone, notes },
      status: 'confirmed',
      createdAt: new Date(),
      source: 'web'
    };
    const ref = await db.collection('reservations').add(reservation);
    // Notificaciones asíncronas (opcional)
    return res.status(201).json({ success: true, reservationId: ref.id });
  }

  // ========== ADMIN ROUTES (protegidas) ==========
  const isAdmin = req.headers.authorization === `Bearer ${process.env.ADMIN_API_KEY || 'admin123'}`;
  
  // GET /api/admin/reservations
  if (req.method === 'GET' && route === '/admin/reservations') {
    if (!isAdmin) return res.status(401).json({ error: 'No autorizado' });
    const db = getDb();
    const snapshot = await db.collection('reservations').orderBy('date', 'desc').orderBy('time', 'desc').get();
    const reservations = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    return res.json({ reservations });
  }

  // PUT /api/admin/reservations/[id]
  if (req.method === 'PUT' && route.match(/^\/admin\/reservations\/[^/]+$/)) {
    if (!isAdmin) return res.status(401).json({ error: 'No autorizado' });
    const id = route.split('/').pop();
    const { date, time } = req.body;
    await getDb().collection('reservations').doc(id).update({ date, time, updatedAt: new Date() });
    return res.json({ success: true });
  }

  // POST /api/admin/reservations/[id]/cancel
  if (req.method === 'POST' && route.endsWith('/cancel')) {
    if (!isAdmin) return res.status(401).json({ error: 'No autorizado' });
    const id = route.split('/')[3];
    const { reason } = req.body;
    await getDb().collection('reservations').doc(id).update({
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelReason: reason || 'Cancelado por admin'
    });
    return res.json({ success: true });
  }

  // POST /api/admin/config  (guardar configuración)
  if (req.method === 'POST' && route === '/admin/config') {
    if (!isAdmin) return res.status(401).json({ error: 'No autorizado' });
    const { business, schedule, services } = req.body;
    const db = getDb();
    // Actualizar business
    await db.collection('business').doc('config').update({
      name: business.name,
      tagline: business.tagline,
      primaryColor: business.primaryColor,
      location: business.location,
      schedule
    });
    // Reemplazar servicios (borrar todos y volver a crear)
    const batch = db.batch();
    const existing = await db.collection('services').get();
    existing.docs.forEach(doc => batch.delete(doc.ref));
    services.forEach((svc, idx) => {
      const ref = db.collection('services').doc(`svc_${Date.now()}_${idx}`);
      batch.set(ref, { ...svc, active: svc.active !== false, order: idx });
    });
    await batch.commit();
    return res.json({ success: true });
  }

  // ========== HTML PAGES ==========
  if (req.method === 'GET' && (route === '/' || route === '')) {
    return res.setHeader('Content-Type', 'text/html').send(landingHTML);
  }
  if (req.method === 'GET' && route === '/admin') {
    return res.setHeader('Content-Type', 'text/html').send(adminHTML);
  }

  return res.status(404).json({ error: 'Ruta no encontrada' });
}
