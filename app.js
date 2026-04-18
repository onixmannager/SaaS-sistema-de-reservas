// ============================================================
//  app.js — Módulo central de la aplicación
//  Inicializa Firebase con variables de entorno de Vercel y
//  exporta todas las funciones de datos para reserva.html y admin.html
// ============================================================

import { initializeApp }        from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getFirestore,
  collection, addDoc, getDocs, updateDoc, doc,
  query, where, orderBy, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';


// ============================================================
//  CONFIGURACIÓN DEL NEGOCIO
//  ✏️  Edita esta sección con los datos de tu negocio.
// ============================================================
export const CONFIG = {
  business: {
    name:         "Mi Negocio",
    tagline:      "Reserva tu cita en segundos",
    primaryColor: "#0066F0",
    location:     "Online · Google Meet",
  },
  services: [
    { id: "sv1", name: "Consultoría Express", duration: 30, priceFormatted: "Gratuita", active: true },
    { id: "sv2", name: "Mentoría Completa",   duration: 60, priceFormatted: "49 €",     active: true },
  ],
  schedule: {
    monday:    { start: "09:00", end: "17:00", closed: false },
    tuesday:   { start: "09:00", end: "17:00", closed: false },
    wednesday: { start: "09:00", end: "17:00", closed: false },
    thursday:  { start: "09:00", end: "17:00", closed: false },
    friday:    { start: "09:00", end: "15:00", closed: false },
    saturday:  { closed: true },
    sunday:    { closed: true },
  },
  booking: {
    maxAdvanceDays: 60,
  },
};


// ============================================================
//  INICIALIZACIÓN FIREBASE
//  Las credenciales viven en variables de entorno de Vercel
//  y se sirven de forma segura desde /api/config.js
// ============================================================
let db = null;

export async function initApp() {
  if (db) return; // ya inicializado, no repetir

  const res = await fetch('/api/config');
  if (!res.ok) throw new Error('No se pudo obtener la configuración de Firebase.');

  const firebaseConfig = await res.json();
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
}


// ============================================================
//  HELPERS INTERNOS DE HORARIO
// ============================================================
function timeToMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minToTime(m) {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function buildLocalSlots(date, duration) {
  const DAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const d    = new Date(date + 'T00:00:00');
  const sched = CONFIG.schedule[DAYS[d.getDay()]];
  if (!sched || sched.closed) return [];

  const slots = [];
  for (let m = timeToMin(sched.start); m + duration <= timeToMin(sched.end); m += duration) {
    slots.push(minToTime(m));
  }
  return slots;
}


// ============================================================
//  DISPONIBILIDAD
//  Devuelve array: [{ start: "09:00", available: true }, ...]
// ============================================================
export async function getAvailability(date, duration) {
  await initApp();

  const allSlots = buildLocalSlots(date, duration);
  if (!allSlots.length) return [];

  // Consultar slots ya ocupados ese día
  const q = query(
    collection(db, 'reservations'),
    where('date',   '==', date),
    where('status', 'in', ['confirmed', 'pending'])
  );
  const snap     = await getDocs(q);
  const occupied = snap.docs.map(d => d.data().time);

  return allSlots.map(start => ({
    start,
    available: !occupied.includes(start),
  }));
}


// ============================================================
//  CREAR RESERVA (desde reserva.html)
//  Lanza Error('SLOT_TAKEN') si el hueco ya no está libre
// ============================================================
export async function createReservation({ serviceId, date, startTime, duration, name, email, phone, notes }) {
  await initApp();

  const service = CONFIG.services.find(s => s.id === serviceId);
  if (!service) throw new Error('Servicio no encontrado.');

  // Doble verificación de disponibilidad (race condition prevention)
  const conflict = query(
    collection(db, 'reservations'),
    where('date',   '==', date),
    where('time',   '==', startTime),
    where('status', 'in', ['confirmed', 'pending'])
  );
  const check = await getDocs(conflict);
  if (!check.empty) throw new Error('SLOT_TAKEN');

  const ref = await addDoc(collection(db, 'reservations'), {
    serviceId,
    serviceName: service.name,
    date,
    time:        startTime,
    duration,
    status:      'confirmed',
    customer:    { name, email, phone: phone || '', notes: notes || '' },
    createdAt:   serverTimestamp(),
  });

  return { id: ref.id };
}


// ============================================================
//  LEER RESERVAS (admin)
//  Devuelve array con todas las reservas, más recientes primero
// ============================================================
export async function getReservations() {
  await initApp();

  const snap = await getDocs(
    query(collection(db, 'reservations'), orderBy('date', 'desc'), orderBy('time', 'desc'))
  );
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}


// ============================================================
//  ACTUALIZAR RESERVA (admin — editar datos)
// ============================================================
export async function updateReservation(id, { name, email, phone, serviceId, date, time, status, notes }) {
  await initApp();

  const service = CONFIG.services.find(s => s.id === serviceId);

  await updateDoc(doc(db, 'reservations', id), {
    serviceId,
    serviceName:       service ? service.name : serviceId,
    date,
    time,
    status,
    'customer.name':   name,
    'customer.email':  email,
    'customer.phone':  phone  || '',
    'customer.notes':  notes  || '',
    updatedAt:         serverTimestamp(),
  });
}


// ============================================================
//  CANCELAR RESERVA (admin)
// ============================================================
export async function cancelReservation(id, reason = '') {
  await initApp();

  await updateDoc(doc(db, 'reservations', id), {
    status:      'cancelled',
    cancelReason: reason,
    cancelledAt:  serverTimestamp(),
  });
}


// ============================================================
//  CREAR RESERVA DESDE ADMIN (nueva cita manual)
// ============================================================
export async function adminCreateReservation({ name, email, phone, serviceId, date, time, status, notes }) {
  await initApp();

  const service = CONFIG.services.find(s => s.id === serviceId);

  await addDoc(collection(db, 'reservations'), {
    serviceId,
    serviceName: service ? service.name : serviceId,
    date,
    time,
    duration:    service ? service.duration : 60,
    status:      status || 'confirmed',
    customer:    { name, email, phone: phone || '', notes: notes || '' },
    createdAt:   serverTimestamp(),
  });
}


// ============================================================
//  VERIFICAR CONTRASEÑA DE ADMINISTRADOR
//  Compara contra la variable ADMIN_PASSWORD en Vercel
// ============================================================
export async function verifyAdmin(password) {
  const res = await fetch('/api/admin-verify', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ password }),
  });
  return res.ok;
}
