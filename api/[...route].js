// api/[...route].js
// ============================================================
// SISTEMA DE RESERVAS COMPLETO - Todo en uno
// ============================================================
// Despliegue: Subir a Vercel con variables de entorno de Firebase
// ============================================================

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { Resend } from 'resend';

// ========== CONFIGURACIÓN FIREBASE (desde variables de entorno) ==========
const firebaseConfig = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
};

// Inicializar Firebase Admin (singleton)
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

// Inicializar Resend para emails
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// ========== FUNCIONES AUXILIARES ==========
function generateSlots(start, end, duration, bookedSlots, buffer = 0) {
  const slots = [];
  let current = start;
  
  while (current + duration <= end) {
    const slotStart = current;
    const slotEnd = current + duration;
    
    // Verificar disponibilidad
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

async function sendEmail(to, subject, html) {
  if (!resend) return;
  try {
    await resend.emails.send({
      from: process.env.EMAIL_FROM || 'Reservas <onboarding@resend.dev>',
      to: [to],
      subject,
      html
    });
  } catch (e) {
    console.error('Error enviando email:', e);
  }
}

async function sendTelegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'Markdown' })
    });
  } catch (e) {
    console.error('Error Telegram:', e);
  }
}

// ========== HTMLs ESTÁTICOS ==========
const landingHTML = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reservas · Sistema Profesional</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    :root{--primary:#0066F0;--gray-50:#F9FAFB;--gray-100:#F3F4F6;--gray-200:#E5E7EB;--gray-500:#6B7280;--gray-800:#1F2937;--gray-900:#111827;--success:#10B981;--error:#EF4444;--radius:16px}
    body{font-family:'Inter',sans-serif;background:var(--gray-100);padding:16px;min-height:100vh;display:flex;align-items:center;justify-content:center}
    .card{max-width:500px;width:100%;background:white;border-radius:var(--radius);box-shadow:0 20px 25px -5px rgba(0,0,0,0.1);padding:32px}
    h1{font-size:28px;font-weight:700;margin-bottom:8px}
    .subtitle{color:var(--gray-500);margin-bottom:24px}
    .step{margin-bottom:24px}
    .step-title{font-weight:600;margin-bottom:12px}
    .service-list{display:grid;gap:10px}
    .service-btn{display:flex;justify-content:space-between;padding:16px;border:2px solid var(--gray-200);border-radius:12px;background:white;cursor:pointer;text-align:left;font-family:inherit}
    .service-btn.selected{border-color:var(--primary);background:#E5F0FF}
    .calendar-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-top:12px}
    .cal-day{aspect-ratio:1;display:flex;align-items:center;justify-content:center;border-radius:40px;cursor:pointer;font-weight:500}
    .cal-day:hover:not(.disabled){background:var(--gray-100)}
    .cal-day.disabled{color:#D1D5DB;cursor:not-allowed}
    .cal-day.selected{background:var(--primary);color:white}
    .time-slots{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:16px 0}
    .time-btn{padding:12px;border:1.5px solid var(--gray-200);border-radius:40px;background:white;cursor:pointer}
    .time-btn.selected{background:var(--primary);color:white;border-color:var(--primary)}
    input,textarea,select{width:100%;padding:12px;border:1.5px solid var(--gray-200);border-radius:12px;font-family:inherit;margin-bottom:12px}
    .btn{width:100%;padding:16px;background:var(--primary);color:white;border:none;border-radius:40px;font-weight:600;cursor:pointer;font-size:16px}
    .btn:disabled{opacity:0.5;cursor:not-allowed}
    .hidden{display:none !important}
    .result{padding:16px;border-radius:12px;margin-top:16px}
    .success{background:#D1FAE5;color:#065F46}
    .error{background:#FEE2E2;color:#991B1B}
  </style>
</head>
<body>
<div class="card">
  <h1>Reserva tu cita</h1>
  <p class="subtitle" id="businessName">Consultoría Profesional</p>
  
  <div id="stepService" class="step">
    <div class="step-title">1. Elige un servicio</div>
    <div class="service-list" id="services"></div>
    <button class="btn" id="continueService" disabled>Continuar</button>
  </div>
  
  <div id="stepDateTime" class="step hidden">
    <div class="step-title">2. Fecha y hora</div>
    <div id="calendar"></div>
    <div id="times" class="time-slots hidden"></div>
    <button class="btn" id="continueDateTime" disabled>Continuar</button>
  </div>
  
  <div id="stepDetails" class="step hidden">
    <div class="step-title">3. Tus datos</div>
    <input type="text" id="name" placeholder="Nombre completo" required>
    <input type="email" id="email" placeholder="Email" required>
    <input type="tel" id="phone" placeholder="Teléfono (opcional)">
    <textarea id="notes" placeholder="Notas adicionales" rows="2"></textarea>
    <button class="btn" id="confirmBtn">Confirmar reserva</button>
    <div id="result" class="result hidden"></div>
  </div>
</div>
<script>
  let config = null;
  let state = { service: null, date: null, time: null, month: new Date() };
  
  async function init() {
    try {
      const res = await fetch('/api/config');
      config = await res.json();
      document.getElementById('businessName').textContent = config.business.name;
      renderServices();
    } catch(e) { alert('Error cargando configuración'); }
  }
  
  function renderServices() {
    const html = config.services.map(s => 
      \`<button class="service-btn" data-id="\${s.id}">
        <span><strong>\${s.name}</strong><br><small>\${s.duration} min</small></span>
        <span>\${s.priceFormatted}</span>
      </button>\`
    ).join('');
    document.getElementById('services').innerHTML = html;
    document.querySelectorAll('.service-btn').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.service-btn').forEach(x => x.classList.remove('selected'));
        b.classList.add('selected');
        state.service = config.services.find(s => s.id === b.dataset.id);
        document.getElementById('continueService').disabled = false;
      });
    });
  }
  
  document.getElementById('continueService').addEventListener('click', () => {
    document.getElementById('stepService').classList.add('hidden');
    document.getElementById('stepDateTime').classList.remove('hidden');
    renderCalendar();
  });
  
  function renderCalendar() {
    const year = state.month.getFullYear();
    const month = state.month.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const today = new Date(); today.setHours(0,0,0,0);
    const maxDate = new Date(today); maxDate.setDate(today.getDate() + config.booking.maxAdvanceDays);
    
    let html = \`<div style="display:flex;justify-content:space-between;margin-bottom:16px">
      <button id="prevMonth">&larr;</button>
      <strong>\${firstDay.toLocaleDateString('es',{month:'long',year:'numeric'})}</strong>
      <button id="nextMonth">&rarr;</button>
    </div><div class="calendar-grid">\`;
    
    html += ['L','M','X','J','V','S','D'].map(d => \`<div style="text-align:center;font-size:12px;color:gray">\${d}</div>\`).join('');
    
    const startDow = (firstDay.getDay() + 6) % 7;
    for(let i=0;i<startDow;i++) html += '<div></div>';
    
    for(let d=1; d<=lastDay.getDate(); d++) {
      const date = new Date(year, month, d);
      const iso = date.toISOString().split('T')[0];
      const dow = date.getDay();
      const schedule = config.schedule[['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][dow]];
      const disabled = date < today || date > maxDate || schedule.closed;
      const selected = iso === state.date;
      html += \`<div class="cal-day \${disabled?'disabled':''} \${selected?'selected':''}" data-date="\${iso}" \${disabled?'':\`data-enabled="true"\`}>\${d}</div>\`;
    }
    document.getElementById('calendar').innerHTML = html + '</div>';
    
    document.getElementById('prevMonth').onclick = () => { state.month.setMonth(state.month.getMonth()-1); renderCalendar(); };
    document.getElementById('nextMonth').onclick = () => { state.month.setMonth(state.month.getMonth()+1); renderCalendar(); };
    
    document.querySelectorAll('.cal-day[data-enabled]').forEach(el => {
      el.addEventListener('click', async () => {
        state.date = el.dataset.date;
        renderCalendar();
        await loadSlots();
      });
    });
  }
  
  async function loadSlots() {
    const res = await fetch(\`/api/availability?date=\${state.date}&service=\${state.service.id}\`);
    const data = await res.json();
    const timesDiv = document.getElementById('times');
    timesDiv.classList.remove('hidden');
    
    const availableSlots = data.slots.filter(s => s.available);
    if (availableSlots.length === 0) {
      timesDiv.innerHTML = '<p style="grid-column:1/-1">No hay horarios</p>';
      return;
    }
    
    timesDiv.innerHTML = availableSlots.map(s => 
      \`<button class="time-btn" data-time="\${s.start}">\${s.start}</button>\`
    ).join('');
    
    document.querySelectorAll('.time-btn').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.time-btn').forEach(x => x.classList.remove('selected'));
        b.classList.add('selected');
        state.time = b.dataset.time;
        document.getElementById('continueDateTime').disabled = false;
      });
    });
  }
  
  document.getElementById('continueDateTime').addEventListener('click', () => {
    document.getElementById('stepDateTime').classList.add('hidden');
    document.getElementById('stepDetails').classList.remove('hidden');
  });
  
  document.getElementById('confirmBtn').addEventListener('click', async () => {
    const btn = document.getElementById('confirmBtn');
    btn.disabled = true;
    btn.textContent = 'Procesando...';
    
    const payload = {
      date: state.date,
      startTime: state.time,
      serviceId: state.service.id,
      name: document.getElementById('name').value,
      email: document.getElementById('email').value,
      phone: document.getElementById('phone').value,
      notes: document.getElementById('notes').value
    };
    
    try {
      const res = await fetch('/api/reservation', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      const result = document.getElementById('result');
      result.classList.remove('hidden');
      if (data.success) {
        result.className = 'result success';
        result.innerHTML = '<strong>¡Reserva confirmada!</strong><br>Revisa tu email.';
      } else {
        result.className = 'result error';
        result.textContent = data.error === 'SLOT_TAKEN' ? 'Horario no disponible' : 'Error';
      }
    } catch(e) {
      alert('Error de conexión');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Confirmar reserva';
    }
  });
  
  init();
</script>
</body>
</html>`;

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
    table{width:100%;background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,0.1)}
    th{background:#1F2937;color:white;padding:12px;text-align:left}
    td{padding:12px;border-bottom:1px solid #E5E7EB}
    .badge{padding:4px 8px;border-radius:20px;font-size:12px;font-weight:600}
    .confirmed{background:#D1FAE5;color:#065F46}
    .cancelled{background:#FEE2E2;color:#991B1B}
    .btn{padding:8px 16px;border:none;border-radius:6px;cursor:pointer;margin-right:8px}
    .btn-edit{background:#0066F0;color:white}
    .btn-cancel{background:#EF4444;color:white}
    input{padding:10px;border:1px solid #D1D5DB;border-radius:8px;width:100%;max-width:300px}
  </style>
</head>
<body>
<div class="container">
  <h1>📋 Panel de Administración</h1>
  <div style="display:flex;gap:20px;margin:20px 0">
    <input type="text" id="search" placeholder="Buscar por nombre o email...">
    <select id="filterStatus" style="padding:10px;border-radius:8px">
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

<script>
  let allReservations = [];
  const ADMIN_KEY = localStorage.getItem('admin_key') || prompt('Ingresa la clave de administrador:');
  localStorage.setItem('admin_key', ADMIN_KEY);
  
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
    const res = await fetch(\`/api/admin/reservations/\${id}\`, {
      headers: {'Authorization': 'Bearer ' + ADMIN_KEY}
    });
    const data = await res.json();
    const r = data.reservation;
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
  
  document.getElementById('search').addEventListener('input', renderTable);
  document.getElementById('filterStatus').addEventListener('change', renderTable);
  
  loadReservations();
</script>
</body>
</html>`;

// ========== HANDLER PRINCIPAL DE VERCELL ==========
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  const path = req.query.route || [];
  const route = '/' + path.join('/');
  
  // ========== RUTAS DE API ==========
  
  // GET /api/config
  if (req.method === 'GET' && route === '/config') {
    const db = getDb();
    const businessDoc = await db.collection('business').doc('config').get();
    const business = businessDoc.data() || {
      name: 'Mi Negocio',
      tagline: 'Servicios profesionales',
      primaryColor: '#0066F0',
      location: 'Online',
      schedule: {
        monday: {start:'09:00',end:'17:00',closed:false},
        tuesday: {start:'09:00',end:'17:00',closed:false},
        wednesday: {start:'09:00',end:'17:00',closed:false},
        thursday: {start:'09:00',end:'17:00',closed:false},
        friday: {start:'09:00',end:'15:00',closed:false},
        saturday: {closed:true},
        sunday: {closed:true}
      },
      booking: { slotDuration:30, minAdvanceHours:1, maxAdvanceDays:60 }
    };
    
    const servicesSnap = await db.collection('services').where('active','==',true).get();
    const services = servicesSnap.docs.map(d => ({id:d.id, ...d.data()}));
    
    return res.json({
      business,
      services: services.length ? services : [
        {id:'sv1', name:'Consultoría', duration:30, priceFormatted:'50€', active:true}
      ],
      schedule: business.schedule,
      booking: business.booking,
      ui: { locale:'es', texts:{} }
    });
  }
  
  // GET /api/availability?date=&service=
  if (req.method === 'GET' && route === '/availability') {
    const { date, service } = req.query;
    if (!date) return res.status(400).json({error:'Fecha requerida'});
    
    const db = getDb();
    const businessDoc = await db.collection('business').doc('config').get();
    const business = businessDoc.data() || { schedule: {}, booking: { slotDuration: 30 } };
    
    const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const selectedDate = new Date(date);
    const daySchedule = business.schedule[dayNames[selectedDate.getDay()]] || { closed: true };
    
    if (daySchedule.closed) return res.json({slots:[]});
    
    let duration = business.booking.slotDuration || 30;
    if (service) {
      const svc = await db.collection('services').doc(service).get();
      if (svc.exists) duration = svc.data().duration;
    }
    
    const [startH, startM] = daySchedule.start.split(':').map(Number);
    const [endH, endM] = daySchedule.end.split(':').map(Number);
    const start = startH * 60 + startM;
    const end = endH * 60 + endM;
    
    const bookingsSnap = await db.collection('reservations')
      .where('date','==',date)
      .where('status','in',['confirmed','pending']).get();
    
    const booked = bookingsSnap.docs.map(d => {
      const b = d.data();
      const [h,m] = b.time.split(':').map(Number);
      return { start: h*60+m, duration: b.serviceDuration || duration };
    });
    
    const slots = generateSlots(start, end, duration, booked, 0);
    return res.json({slots});
  }
  
  // POST /api/reservation
  if (req.method === 'POST' && route === '/reservation') {
    const { date, startTime, serviceId, name, email, phone, notes } = req.body;
    if (!date || !startTime || !serviceId || !name || !email) {
      return res.status(400).json({success:false, error:'Faltan campos'});
    }
    
    const db = getDb();
    
    // Verificar disponibilidad nuevamente
    const businessDoc = await db.collection('business').doc('config').get();
    const business = businessDoc.data();
    const serviceDoc = await db.collection('services').doc(serviceId).get();
    const service = serviceDoc.data();
    
    const duration = service?.duration || 30;
    const [slotH, slotM] = startTime.split(':').map(Number);
    const slotStart = slotH * 60 + slotM;
    const slotEnd = slotStart + duration;
    
    const existing = await db.collection('reservations')
      .where('date','==',date)
      .where('status','in',['confirmed','pending']).get();
    
    const conflict = existing.docs.some(d => {
      const b = d.data();
      const [h,m] = b.time.split(':').map(Number);
      const bStart = h*60+m;
      const bEnd = bStart + (b.serviceDuration || duration);
      return slotStart < bEnd && slotEnd > bStart;
    });
    
    if (conflict) {
      return res.status(409).json({success:false, error:'SLOT_TAKEN'});
    }
    
    const reservation = {
      date, time: startTime,
      serviceId, serviceName: service.name, serviceDuration: duration,
      customer: { name, email, phone, notes },
      status: 'confirmed',
      createdAt: new Date(),
      source: 'web'
    };
    
    const ref = await db.collection('reservations').add(reservation);
    
    // Notificaciones (async)
    const dateFormatted = new Date(date + 'T00:00:00').toLocaleDateString('es-ES', {dateStyle:'full'});
    sendEmail(email, 'Reserva confirmada', 
      `<h2>¡Reserva confirmada!</h2><p>${service.name} - ${dateFormatted} a las ${startTime}</p>`);
    
    const adminMsg = `🆕 *Nueva reserva*\n👤 ${name}\n📧 ${email}\n📅 ${dateFormatted} ${startTime}\n📋 ${service.name}`;
    sendTelegram(adminMsg);
    
    return res.status(201).json({success:true, reservationId: ref.id});
  }
  
  // ========== RUTAS ADMIN (protegidas con API Key) ==========
  
  const isAdmin = req.headers.authorization === `Bearer ${process.env.ADMIN_API_KEY || 'admin123'}`;
  
  // GET /api/admin/reservations
  if (req.method === 'GET' && route === '/admin/reservations') {
    if (!isAdmin) return res.status(401).json({error:'No autorizado'});
    const db = getDb();
    const snapshot = await db.collection('reservations').orderBy('date','desc').orderBy('time','desc').get();
    const reservations = snapshot.docs.map(d => ({id: d.id, ...d.data()}));
    return res.json({reservations});
  }
  
  // PUT /api/admin/reservations/[id]
  if (req.method === 'PUT' && route.startsWith('/admin/reservations/') && !route.endsWith('/cancel')) {
    if (!isAdmin) return res.status(401).json({error:'No autorizado'});
    const id = route.split('/').pop();
    const { date, time } = req.body;
    const db = getDb();
    await db.collection('reservations').doc(id).update({ date, time, updatedAt: new Date() });
    return res.json({success:true});
  }
  
  // POST /api/admin/reservations/[id]/cancel
  if (req.method === 'POST' && route.endsWith('/cancel')) {
    if (!isAdmin) return res.status(401).json({error:'No autorizado'});
    const id = route.split('/')[3];
    const { reason } = req.body;
    const db = getDb();
    await db.collection('reservations').doc(id).update({
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelReason: reason || 'Cancelado por admin'
    });
    return res.json({success:true});
  }
  
  // ========== SERVIR HTMLs ==========
  
  // Página principal de reservas
  if (req.method === 'GET' && (route === '/' || route === '')) {
    return res.setHeader('Content-Type', 'text/html').send(landingHTML);
  }
  
  // Panel de administración
  if (req.method === 'GET' && route === '/admin') {
    return res.setHeader('Content-Type', 'text/html').send(adminHTML);
  }
  
  // 404
  return res.status(404).json({error:'Ruta no encontrada'});
    }
