// api/[...route].js
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

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

// ========== UTILIDADES ==========
function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

// ========== HANDLER ==========
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const path = req.query.route || [];
  const route = '/' + path.join('/');

  // GET /api/availability?date=YYYY-MM-DD&duration=30
  if (req.method === 'GET' && route === '/availability') {
    const { date, duration } = req.query;
    if (!date || !duration) return res.status(400).json({ error: 'Faltan date o duration' });

    const durationNum = parseInt(duration, 10);
    const db = getDb();
    const reservationsSnap = await db.collection('reservations')
      .where('date', '==', date)
      .where('status', 'in', ['confirmed', 'pending'])
      .get();

    const occupied = [];
    reservationsSnap.docs.forEach(doc => {
      const r = doc.data();
      const start = timeToMinutes(r.time);
      const end = start + (r.serviceDuration || durationNum);
      for (let t = start; t < end; t += durationNum) {
        occupied.push(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
      }
    });

    // Eliminar duplicados
    const uniqueOccupied = [...new Set(occupied)];
    return res.json({ occupied: uniqueOccupied });
  }

  // POST /api/reservation
  if (req.method === 'POST' && route === '/reservation') {
    const { date, startTime, duration, serviceId, name, email, phone, notes } = req.body;
    if (!date || !startTime || !duration || !name || !email) {
      return res.status(400).json({ success: false, error: 'Faltan campos' });
    }

    const db = getDb();
    const durationNum = parseInt(duration, 10);
    const slotStart = timeToMinutes(startTime);
    const slotEnd = slotStart + durationNum;

    const existing = await db.collection('reservations')
      .where('date', '==', date)
      .where('status', 'in', ['confirmed', 'pending'])
      .get();

    const conflict = existing.docs.some(doc => {
      const r = doc.data();
      const rStart = timeToMinutes(r.time);
      const rEnd = rStart + (r.serviceDuration || durationNum);
      return (slotStart < rEnd && slotEnd > rStart);
    });

    if (conflict) {
      return res.status(409).json({ success: false, error: 'SLOT_TAKEN' });
    }

    const reservation = {
      date,
      time: startTime,
      serviceId: serviceId || 'unknown',
      serviceDuration: durationNum,
      customer: { name, email, phone, notes },
      status: 'confirmed',
      createdAt: new Date(),
      source: 'web'
    };

    const ref = await db.collection('reservations').add(reservation);
    return res.status(201).json({ success: true, reservationId: ref.id });
  }

  // ========== ADMIN ROUTES ==========
  const isAdmin = req.headers.authorization === `Bearer ${process.env.ADMIN_API_KEY || 'admin123'}`;

  if (req.method === 'GET' && route === '/admin/reservations') {
    if (!isAdmin) return res.status(401).json({ error: 'No autorizado' });
    const db = getDb();
    const snapshot = await db.collection('reservations').orderBy('date', 'desc').orderBy('time', 'desc').get();
    const reservations = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    return res.json({ reservations });
  }

  if (req.method === 'PUT' && route.match(/^\/admin\/reservations\/[^/]+$/)) {
    if (!isAdmin) return res.status(401).json({ error: 'No autorizado' });
    const id = route.split('/').pop();
    const { date, time, status, notes } = req.body;
    const update = { updatedAt: new Date() };
    if (date) update.date = date;
    if (time) update.time = time;
    if (status) update.status = status;
    if (notes !== undefined) update['customer.notes'] = notes;
    await getDb().collection('reservations').doc(id).update(update);
    return res.json({ success: true });
  }

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

  return res.status(404).json({ error: 'Ruta no encontrada' });
}
