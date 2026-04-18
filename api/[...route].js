// api/[...route].js
// ============================================================
// BACKEND ÚNICO – LEE LA CONFIGURACIÓN DESDE config.js
// ============================================================
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { Resend } from 'resend';
import { BUSINESS_CONFIG, SERVICES } from '../config.js';

// ========== FIREBASE ==========
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

// ========== FUNCIONES AUXILIARES ==========
function generateSlots(start, end, duration, bookedSlots) {
  const slots = [];
  let current = start;
  while (current + duration <= end) {
    const slotStart = current;
    const slotEnd = current + duration;
    const isAvailable = !bookedSlots.some(booking => {
      const bookingEnd = booking.start + booking.duration;
      return (slotStart < bookingEnd && slotEnd > booking.start);
    });
    slots.push({
      start: `${String(Math.floor(slotStart / 60)).padStart(2, '0')}:${String(slotStart % 60).padStart(2, '0')}`,
      available: isAvailable
    });
    current += duration;
  }
  return slots;
}

// ========== HTMLs (se mantienen igual, pero ahora leen la config desde el backend) ==========
const landingHTML = `...`; // (el mismo HTML de antes, lo incluyo completo abajo)

const adminHTML = `...`;   // (panel simple para ver reservas, opcional)

// ========== HANDLER PRINCIPAL ==========
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const path = req.query.route || [];
  const route = '/' + path.join('/');

  // ========== API ROUTES ==========
  
  // GET /api/config → devuelve la configuración local
  if (req.method === 'GET' && route === '/config') {
    return res.json({
      business: BUSINESS_CONFIG,
      services: SERVICES.filter(s => s.active),
      schedule: BUSINESS_CONFIG.schedule,
      booking: BUSINESS_CONFIG.booking,
      ui: { locale: 'es', texts: {} }
    });
  }

  // GET /api/availability
  if (req.method === 'GET' && route === '/availability') {
    const { date, service } = req.query;
    if (!date) return res.status(400).json({ error: 'Fecha requerida' });
    
    const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const selectedDate = new Date(date);
    const daySchedule = BUSINESS_CONFIG.schedule[dayNames[selectedDate.getDay()]] || { closed: true };
    if (daySchedule.closed) return res.json({ slots: [] });
    
    let duration = BUSINESS_CONFIG.booking.slotDuration;
    if (service) {
      const svc = SERVICES.find(s => s.id === service);
      if (svc) duration = svc.duration;
    }
    
    const [startH, startM] = daySchedule.start.split(':').map(Number);
    const [endH, endM] = daySchedule.end.split(':').map(Number);
    const start = startH * 60 + startM;
    const end = endH * 60 + endM;
    
    const db = getDb();
    const bookingsSnap = await db.collection('reservations')
      .where('date', '==', date)
      .where('status', 'in', ['confirmed', 'pending']).get();
    const booked = bookingsSnap.docs.map(d => {
      const b = d.data();
      const [h, m] = b.time.split(':').map(Number);
      return { start: h * 60 + m, duration: b.serviceDuration || duration };
    });
    
    const slots = generateSlots(start, end, duration, booked);
    return res.json({ slots });
  }

  // POST /api/reservation
  if (req.method === 'POST' && route === '/reservation') {
    const { date, startTime, serviceId, name, email, phone, notes } = req.body;
    if (!date || !startTime || !serviceId || !name || !email) {
      return res.status(400).json({ success: false, error: 'Faltan campos' });
    }
    
    const service = SERVICES.find(s => s.id === serviceId);
    if (!service) return res.status(400).json({ success: false, error: 'Servicio no encontrado' });
    
    const duration = service.duration;
    const [slotH, slotM] = startTime.split(':').map(Number);
    const slotStart = slotH * 60 + slotM;
    const slotEnd = slotStart + duration;
    
    const db = getDb();
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
    
    // Notificaciones (opcional, usando Resend si está configurado)
    if (process.env.RESEND_API_KEY && BUSINESS_CONFIG.notifications?.sendCustomerEmail) {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const dateFormatted = new Date(date + 'T00:00:00').toLocaleDateString('es-ES', { dateStyle: 'full' });
      resend.emails.send({
        from: process.env.EMAIL_FROM || 'onboarding@resend.dev',
        to: [email],
        subject: `✅ Reserva confirmada en ${BUSINESS_CONFIG.name}`,
        html: `<h2>¡Gracias ${name}!</h2><p>Tu cita para ${service.name} el ${dateFormatted} a las ${startTime} está confirmada.</p>`
      }).catch(console.error);
    }
    
    return res.status(201).json({ success: true, reservationId: ref.id });
  }

  // ========== RUTAS ADMIN (protegidas con API Key) ==========
  const isAdmin = req.headers.authorization === `Bearer ${process.env.ADMIN_API_KEY || 'admin123'}`;
  
  // GET /api/admin/reservations
  if (req.method === 'GET' && route === '/admin/reservations') {
    if (!isAdmin) return res.status(401).json({ error: 'No autorizado' });
    const db = getDb();
    const snapshot = await db.collection('reservations').orderBy('date', 'desc').orderBy('time', 'desc').get();
    const reservations = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    return res.json({ reservations });
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

  // ========== SERVIR HTMLs ==========
  if (req.method === 'GET' && (route === '/' || route === '')) {
    return res.setHeader('Content-Type', 'text/html').send(landingHTML);
  }
  if (req.method === 'GET' && route === '/admin') {
    return res.setHeader('Content-Type', 'text/html').send(adminHTML);
  }

  return res.status(404).json({ error: 'Ruta no encontrada' });
}
