// api/[...route].js
// ============================================================
// BACKEND API – CONFIGURACIÓN INTERNA (sin config.js)
// ============================================================
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// ========== CONFIGURACIÓN POR DEFECTO (EDITABLE AQUÍ) ==========
const DEFAULT_BUSINESS = {
  name: "Mi Negocio",
  tagline: "Reserva tu cita en segundos",
  primaryColor: "#0066F0",
  location: "Online · Google Meet",
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
  },
  notifications: {
    adminEmail: "admin@tunegocio.com",
    telegramChatId: "",
    sendCustomerEmail: true
  }
};

const DEFAULT_SERVICES = [
  {
    id: "sv1",
    name: "Consultoría Express",
    duration: 30,
    priceFormatted: "Gratuita",
    active: true,
    order: 1
  },
  {
    id: "sv2",
    name: "Mentoría Completa",
    duration: 60,
    priceFormatted: "49 €",
    active: true,
    order: 2
  }
];

// ========== INICIALIZACIÓN DE FIREBASE ==========
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

// ========== HANDLER PRINCIPAL ==========
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const path = req.query.route || [];
  const route = '/' + path.join('/');

  // ========== API ROUTES ==========

  // GET /api/config
  if (req.method === 'GET' && route === '/config') {
    return res.json({
      business: DEFAULT_BUSINESS,
      services: DEFAULT_SERVICES.filter(s => s.active),
      schedule: DEFAULT_BUSINESS.schedule,
      booking: DEFAULT_BUSINESS.booking,
      ui: { locale: 'es', texts: {} }
    });
  }

  // GET /api/availability?date=YYYY-MM-DD&service=id
  if (req.method === 'GET' && route === '/availability') {
    const { date, service } = req.query;
    if (!date) return res.status(400).json({ error: 'Fecha requerida' });

    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const selectedDate = new Date(date);
    const daySchedule = DEFAULT_BUSINESS.schedule[dayNames[selectedDate.getDay()]] || { closed: true };
    if (daySchedule.closed) return res.json({ slots: [] });

    let duration = DEFAULT_BUSINESS.booking.slotDuration;
    if (service) {
      const svc = DEFAULT_SERVICES.find(s => s.id === service);
      if (svc) duration = svc.duration;
    }

    const [startH, startM] = daySchedule.start.split(':').map(Number);
    const [endH, endM] = daySchedule.end.split(':').map(Number);
    const start = startH * 60 + startM;
    const end = endH * 60 + endM;

    const db = getDb();
    const bookingsSnap = await db.collection('reservations')
      .where('date', '==', date)
      .where('status', 'in', ['confirmed', 'pending'])
      .get();

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

    const service = DEFAULT_SERVICES.find(s => s.id === serviceId);
    if (!service) return res.status(400).json({ success: false, error: 'Servicio no encontrado' });

    const duration = service.duration;
    const [slotH, slotM] = startTime.split(':').map(Number);
    const slotStart = slotH * 60 + slotM;
    const slotEnd = slotStart + duration;

    const db = getDb();
    const existing = await db.collection('reservations')
      .where('date', '==', date)
      .where('status', 'in', ['confirmed', 'pending'])
      .get();

    const conflict = existing.docs.some(d => {
      const b = d.data();
      const [h, m] = b.time.split(':').map(Number);
      const bStart = h * 60 + m;
      const bEnd = bStart + (b.serviceDuration || duration);
      return slotStart < bEnd && slotEnd > bStart;
    });

    if (conflict) {
      return res.status(409).json({ success: false, error: 'SLOT_TAKEN' });
    }

    const reservation = {
      date,
      time: startTime,
      serviceId,
      serviceName: service.name,
      serviceDuration: duration,
      customer: { name, email, phone, notes },
      status: 'confirmed',
      createdAt: new Date(),
      source: 'web'
    };

    const ref = await db.collection('reservations').add(reservation);

    // Notificaciones opcionales (si tienes Resend configurado)
    if (process.env.RESEND_API_KEY) {
      try {
        const { Resend } = await import('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);
        const dateFormatted = new Date(date + 'T00:00:00').toLocaleDateString('es-ES', { dateStyle: 'full' });
        await resend.emails.send({
          from: process.env.EMAIL_FROM || 'onboarding@resend.dev',
          to: [email],
          subject: `✅ Reserva confirmada en ${DEFAULT_BUSINESS.name}`,
          html: `<h2>¡Gracias ${name}!</h2><p>Tu cita para ${service.name} el ${dateFormatted} a las ${startTime} está confirmada.</p>`
        });
      } catch (e) {
        console.error('Error enviando email:', e);
      }
    }

    return res.status(201).json({ success: true, reservationId: ref.id });
  }

  // ========== ADMIN ROUTES (protegidas) ==========
  const isAdmin = req.headers.authorization === `Bearer ${process.env.ADMIN_API_KEY || 'admin123'}`;

  // GET /api/admin/reservations
  if (req.method === 'GET' && route === '/admin/reservations') {
    if (!isAdmin) return res.status(401).json({ error: 'No autorizado' });
    const db = getDb();
    const snapshot = await db.collection('reservations')
      .orderBy('date', 'desc')
      .orderBy('time', 'desc')
      .get();
    const reservations = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    return res.json({ reservations });
  }

  // PUT /api/admin/reservations/[id]
  if (req.method === 'PUT' && route.match(/^\/admin\/reservations\/[^/]+$/)) {
    if (!isAdmin) return res.status(401).json({ error: 'No autorizado' });
    const id = route.split('/').pop();
    const { date, time, status, notes } = req.body;
    const updateData = { updatedAt: new Date() };
    if (date) updateData.date = date;
    if (time) updateData.time = time;
    if (status) updateData.status = status;
    if (notes !== undefined) updateData['customer.notes'] = notes;
    await getDb().collection('reservations').doc(id).update(updateData);
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
      cancelReason: reason || 'Cancelado por administrador'
    });
    return res.json({ success: true });
  }

  // Si no coincide con ninguna ruta API
  return res.status(404).json({ error: 'API route not found' });
}
