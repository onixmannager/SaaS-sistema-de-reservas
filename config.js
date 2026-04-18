// config.js
// ============================================================
// CONFIGURACIÓN DEL NEGOCIO – ¡EDITA SOLO ESTE ARCHIVO!
// ============================================================

export const BUSINESS_CONFIG = {
  // --- Datos básicos ---
  name: "Mi Negocio",
  tagline: "Reserva tu cita en segundos",
  primaryColor: "#0066F0",        // Código HEX
  location: "Online · Google Meet",

  // --- Horario semanal (días y horas de apertura) ---
  schedule: {
    monday:    { start: "09:00", end: "17:00", closed: false },
    tuesday:   { start: "09:00", end: "17:00", closed: false },
    wednesday: { start: "09:00", end: "17:00", closed: false },
    thursday:  { start: "09:00", end: "17:00", closed: false },
    friday:    { start: "09:00", end: "15:00", closed: false },
    saturday:  { closed: true },
    sunday:    { closed: true }
  },

  // --- Reglas de reserva ---
  booking: {
    slotDuration: 30,         // Duración por defecto de los huecos (minutos)
    minAdvanceHours: 1,       // No permitir reservas con menos de X horas
    maxAdvanceDays: 60        // No permitir reservas más allá de X días
  },

  // --- Notificaciones (opcional) ---
  notifications: {
    adminEmail: "admin@tunegocio.com",   // Recibirá un aviso por cada reserva
    telegramChatId: "",                  // Opcional: ID del chat de Telegram
    sendCustomerEmail: true              // Enviar confirmación al cliente (requiere Resend)
  }
};

// --- Lista de servicios ---
export const SERVICES = [
  {
    id: "sv1",
    name: "Consultoría Express",
    duration: 30,               // en minutos
    priceFormatted: "Gratuita", // Se muestra tal cual
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
  // Añade o quita servicios aquí
];
