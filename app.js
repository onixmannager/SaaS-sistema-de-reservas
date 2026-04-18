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

  // ============================================================
  //  NOTIFICACIONES
  //  ✏️  Activa o desactiva cada canal con true / false.
  //  Las credenciales NO van aquí, van en Vercel → Environment Variables.
  // ============================================================
  notifications: {

    // ── 1. EMAIL AL NEGOCIO ──────────────────────────────────
    //  Avisa al dueño del negocio cada vez que entra una reserva.
    //  Variables de entorno necesarias en Vercel:
    //    RESEND_API_KEY   → tu clave de resend.com (gratis hasta 3000/mes)
    //    RESEND_FROM      → email remitente, ej: "agenda@tudominio.com"
    emailNegocio: {
      active: true,
      to: "dueno@minegocio.com",    // ✏️ cambia por el email del negocio
    },

    // ── 2. EMAIL AL CLIENTE ──────────────────────────────────
    //  Envía confirmación automática al cliente que reservó.
    //  El email del destinatario se toma del formulario de reserva.
    //  Variables de entorno necesarias en Vercel:
    //    RESEND_API_KEY
    //    RESEND_FROM
    emailCliente: {
      active: true,
    },

    // ── 3. TELEGRAM ──────────────────────────────────────────
    //  Mensaje instantáneo al negocio por Telegram. Gratis.
    //  Cómo configurarlo:
    //    1. Habla con @BotFather en Telegram → /newbot → copia el token
    //    2. Manda un mensaje a tu bot y entra a:
    //       https://api.telegram.org/bot<TOKEN>/getUpdates
    //       para obtener tu chat_id
    //  Variables de entorno necesarias en Vercel:
    //    TELEGRAM_BOT_TOKEN   → el token que te dio @BotFather
    //    TELEGRAM_CHAT_ID     → tu chat_id
    telegram: {
      active: false,
    },

    // ── 4. WHATSAPP ───────────────────────────────────────────
    //  Mensaje al negocio por WhatsApp vía Twilio.
    //  Tiene coste por mensaje (~0.05€). Requiere cuenta en twilio.com.
    //  Cómo configurarlo:
    //    1. Crea cuenta en twilio.com
    //    2. Activa el sandbox de WhatsApp en Twilio Console
    //    3. Copia Account SID, Auth Token y el número "From" de Twilio
    //  Variables de entorno necesarias en Vercel:
    //    TWILIO_ACCOUNT_SID      → en Twilio Console
    //    TWILIO_AUTH_TOKEN       → en Twilio Console
    //    TWILIO_WHATSAPP_FROM    → ej: "whatsapp:+14155238886"
    //    TWILIO_WHATSAPP_TO      → ej: "whatsapp:+34600000000" (el del negocio)
    whatsapp: {
      active: false,
    },

  },
};


// ============================================================
//  INICIALIZACIÓN FIREBASE
// ============================================================
let db = null;

export async function initApp() {
  if (db) return;

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
  const DAYS  = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const d     = new Date(date + 'T00:00:00');
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
// ============================================================
export async function getAvailability(date, duration) {
  await initApp();

  const allSlots = buildLocalSlots(date, duration);
  if (!allSlots.length) return [];

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
//  NOTIFICACIONES INTERNAS
//  Se llama sola después de crear una reserva.
//  Solo activa los canales con active: true en CONFIG.
//  Si falla NO bloquea ni cancela la reserva.
// ============================================================
async function sendNotifications(reservationData) {
  const n = CONFIG.notifications;

  const anyActive =
    n.emailNegocio.active ||
    n.emailCliente.active ||
    n.telegram.active     ||
    n.whatsapp.active;

  if (!anyActive) return;

  try {
    await fetch('/api/notify', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reservation:  reservationData,
        businessName: CONFIG.business.name,
        channels: {
          emailNegocio: n.emailNegocio.active ? { to: n.emailNegocio.to } : null,
          emailCliente: n.emailCliente.active  ? true : null,
          telegram:     n.telegram.active      ? true : null,
          whatsapp:     n.whatsapp.active       ? true : null,
        },
      }),
    });
  } catch (e) {
    console.warn('Notificaciones: error al enviar (la reserva se guardó correctamente):', e);
  }
}


// ============================================================
//  CREAR RESERVA (desde reserva.html)
//  Lanza Error('SLOT_TAKEN') si el hueco ya no está libre
// ============================================================
export async function createReservation({ serviceId, date, startTime, duration, name, email, phone, notes }) {
  await initApp();

  const service = CONFIG.services.find(s => s.id === serviceId);
  if (!service) throw new Error('Servicio no encontrado.');

  // Doble verificación de disponibilidad
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
    time:      startTime,
    duration,
    status:    'confirmed',
    customer:  { name, email, phone: phone || '', notes: notes || '' },
    createdAt: serverTimestamp(),
  });

  // Notificaciones (no bloquea si falla)
  sendNotifications({
    id:          ref.id,
    serviceName: service.name,
    date,
    time:        startTime,
    duration,
    customer:    { name, email, phone: phone || '', notes: notes || '' },
  });

  return { id: ref.id };
}


// ============================================================
//  LEER RESERVAS (admin)
// ============================================================
export async function getReservations() {
  await initApp();

  const snap = await getDocs(
    query(collection(db, 'reservations'), orderBy('date', 'desc'), orderBy('time', 'desc'))
  );
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}


// ============================================================
//  ACTUALIZAR RESERVA (admin)
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
    status:       'cancelled',
    cancelReason: reason,
    cancelledAt:  serverTimestamp(),
  });
}


// ============================================================
//  CREAR RESERVA DESDE ADMIN
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
// ============================================================
export async function verifyAdmin(password) {
  const res = await fetch('/api/admin-verify', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ password }),
  });
  return res.ok;
}
