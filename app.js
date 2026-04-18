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
  //  Solo activa los canales que hayas configurado.
  // ============================================================
  notifications: {

    // ── 1. EMAIL AL NEGOCIO (Resend) ─────────────────────────
    //  Avisa al dueño del negocio cada vez que entra una reserva.
    //  Variables de entorno necesarias en Vercel:
    //    RESEND_API_KEY   → tu clave de resend.com
    //    RESEND_FROM      → ej: "Agenda <agenda@tudominio.com>"
    emailNegocio: {
      active: false,
      to: "dueno@minegocio.com",    // ✏️ email del dueño del negocio
    },

    // ── 2. EMAIL AL CLIENTE (Resend) ─────────────────────────
    //  Envía confirmación automática al cliente que reservó.
    //  El email del destinatario se toma del formulario de reserva.
    //  Variables de entorno necesarias en Vercel:
    //    RESEND_API_KEY
    //    RESEND_FROM
    emailCliente: {
      active: false,
    },

    // ── 3. TELEGRAM ──────────────────────────────────────────
    //  Mensaje instantáneo al negocio. Gratis e ilimitado.
    //  Cómo obtener el token y chat_id: habla con @BotFather
    //  en Telegram → /newbot → copia el token → escríbele al
    //  bot → abre api.telegram.org/bot<TOKEN>/getUpdates
    //  Variables de entorno necesarias en Vercel:
    //    TELEGRAM_BOT_TOKEN
    //    TELEGRAM_CHAT_ID
    telegram: {
      active: false,
    },

    // ── 4. WHATSAPP (Twilio) ──────────────────────────────────
    //  Mensaje al negocio por WhatsApp. ~0.05€ por mensaje.
    //  Variables de entorno necesarias en Vercel:
    //    TWILIO_ACCOUNT_SID
    //    TWILIO_AUTH_TOKEN
    //    TWILIO_WHATSAPP_FROM   → ej: "whatsapp:+14155238886"
    //    TWILIO_WHATSAPP_TO     → ej: "whatsapp:+34600000000"
    whatsapp: {
      active: false,
    },

    // ── 5. EMAILJS ────────────────────────────────────────────
    //  Email gratuito (200/mes) sin necesidad de dominio propio.
    //  Envía desde el Gmail o email del negocio directamente.
    //  No necesita variables de entorno en Vercel — las claves
    //  van aquí porque EmailJS está diseñado para usarse en el cliente.
    //  Cómo configurarlo:
    //    1. Crea cuenta en https://emailjs.com (gratis)
    //    2. Ve a "Email Services" → conecta tu Gmail o email
    //    3. Copia el Service ID (ej: "service_abc123")
    //    4. Ve a "Email Templates" → crea una plantilla
    //       En el asunto y cuerpo puedes usar estas variables:
    //         {{business_name}}, {{customer_name}}, {{customer_email}}
    //         {{customer_phone}}, {{service_name}}, {{date}}, {{time}}
    //         {{duration}}, {{notes}}
    //    5. Copia el Template ID (ej: "template_xyz789")
    //    6. Ve a "Account" → copia tu Public Key (ej: "user_ABC...")
    emailjs: {
      active: false,
      publicKey:  "user_XXXXXXXXXXXXXXXXX",   // ✏️ tu Public Key de EmailJS
      serviceId:  "service_XXXXXXXXX",         // ✏️ tu Service ID de EmailJS
      templateId: "template_XXXXXXXXX",        // ✏️ tu Template ID de EmailJS
      to:         "dueno@minegocio.com",        // ✏️ email donde llega el aviso
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
//  NOTIFICACIONES — EmailJS (canal 5, se ejecuta en el cliente)
//  Los otros 4 canales van por /api/notify (servidor)
// ============================================================
async function sendEmailJS(reservationData) {
  const ejs = CONFIG.notifications.emailjs;
  if (!ejs.active) return;

  const dateParts    = reservationData.date.split('-');
  const dateReadable = `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`;

  try {
    await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id:  ejs.serviceId,
        template_id: ejs.templateId,
        user_id:     ejs.publicKey,
        template_params: {
          to_email:      ejs.to,
          business_name: CONFIG.business.name,
          customer_name:  reservationData.customer.name,
          customer_email: reservationData.customer.email,
          customer_phone: reservationData.customer.phone || 'No indicado',
          service_name:   reservationData.serviceName,
          date:           dateReadable,
          time:           reservationData.time,
          duration:       reservationData.duration + ' min',
          notes:          reservationData.customer.notes || 'Ninguna',
        },
      }),
    });
  } catch (e) {
    console.warn('EmailJS: error al enviar (la reserva se guardó correctamente):', e);
  }
}


// ============================================================
//  NOTIFICACIONES — Canales servidor (Resend, Telegram, WhatsApp)
//  Se llama sola después de crear una reserva.
//  Si falla NO bloquea ni cancela la reserva.
// ============================================================
async function sendServerNotifications(reservationData) {
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
    console.warn('Notificaciones servidor: error (la reserva se guardó correctamente):', e);
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

  const reservationData = {
    id:          ref.id,
    serviceName: service.name,
    date,
    time:        startTime,
    duration,
    customer:    { name, email, phone: phone || '', notes: notes || '' },
  };

  // Lanzar todos los canales (ninguno bloquea si falla)
  sendServerNotifications(reservationData);  // Resend, Telegram, WhatsApp
  sendEmailJS(reservationData);              // EmailJS (cliente)

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
