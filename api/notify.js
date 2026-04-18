// api/notify.js — Vercel Serverless Function
// Gestiona el envío de notificaciones por los 4 canales disponibles.
// Las credenciales se leen desde las variables de entorno de Vercel.
//
// Variables necesarias según los canales activos:
//
//  Email (emailNegocio y emailCliente):
//    RESEND_API_KEY     → tu clave de resend.com
//    RESEND_FROM        → email remitente ej: "Agenda <agenda@tudominio.com>"
//
//  Telegram:
//    TELEGRAM_BOT_TOKEN → token de @BotFather
//    TELEGRAM_CHAT_ID   → chat_id de tu conversación con el bot
//
//  WhatsApp (Twilio):
//    TWILIO_ACCOUNT_SID    → en Twilio Console
//    TWILIO_AUTH_TOKEN     → en Twilio Console
//    TWILIO_WHATSAPP_FROM  → ej: "whatsapp:+14155238886"
//    TWILIO_WHATSAPP_TO    → ej: "whatsapp:+34600000000"

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { reservation, channels, businessName } = req.body;
  if (!reservation || !channels) {
    return res.status(400).json({ error: 'Datos incompletos.' });
  }

  // Formatear fecha legible
  const dateParts  = reservation.date.split('-');
  const dateReadable = `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`;

  // Texto del mensaje (igual para todos los canales del negocio)
  const msgNegocio = [
    `📅 Nueva reserva en ${businessName}`,
    ``,
    `👤 Cliente: ${reservation.customer.name}`,
    `📧 Email:   ${reservation.customer.email}`,
    `📞 Teléfono: ${reservation.customer.phone || 'No indicado'}`,
    `🗓️  Fecha:   ${dateReadable} a las ${reservation.time}`,
    `🛎️  Servicio: ${reservation.serviceName} (${reservation.duration} min)`,
    reservation.customer.notes ? `📝 Notas: ${reservation.customer.notes}` : '',
  ].filter(Boolean).join('\n');

  const msgCliente = [
    `✅ Reserva confirmada en ${businessName}`,
    ``,
    `Hola ${reservation.customer.name}, tu cita ha sido confirmada:`,
    ``,
    `🗓️  Fecha:    ${dateReadable}`,
    `🕐 Hora:     ${reservation.time}`,
    `🛎️  Servicio: ${reservation.serviceName} (${reservation.duration} min)`,
    ``,
    `Si necesitas cancelar o modificar tu cita, contáctanos.`,
    ``,
    `Gracias por confiar en ${businessName}.`,
  ].join('\n');

  const results = {};

  // ============================================================
  //  1. EMAIL AL NEGOCIO
  // ============================================================
  if (channels.emailNegocio) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          from:    process.env.RESEND_FROM,
          to:      [channels.emailNegocio.to],
          subject: `Nueva reserva — ${reservation.customer.name} · ${dateReadable} ${reservation.time}`,
          text:    msgNegocio,
        }),
      });
      results.emailNegocio = r.ok ? 'ok' : `error ${r.status}`;
    } catch (e) {
      results.emailNegocio = `exception: ${e.message}`;
    }
  }

  // ============================================================
  //  2. EMAIL AL CLIENTE
  // ============================================================
  if (channels.emailCliente) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          from:    process.env.RESEND_FROM,
          to:      [reservation.customer.email],
          subject: `Confirmación de tu reserva en ${businessName}`,
          text:    msgCliente,
        }),
      });
      results.emailCliente = r.ok ? 'ok' : `error ${r.status}`;
    } catch (e) {
      results.emailCliente = `exception: ${e.message}`;
    }
  }

  // ============================================================
  //  3. TELEGRAM
  // ============================================================
  if (channels.telegram) {
    try {
      const r = await fetch(
        `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id:    process.env.TELEGRAM_CHAT_ID,
            text:       msgNegocio,
            parse_mode: 'HTML',
          }),
        }
      );
      results.telegram = r.ok ? 'ok' : `error ${r.status}`;
    } catch (e) {
      results.telegram = `exception: ${e.message}`;
    }
  }

  // ============================================================
  //  4. WHATSAPP (Twilio)
  // ============================================================
  if (channels.whatsapp) {
    try {
      const sid   = process.env.TWILIO_ACCOUNT_SID;
      const token = process.env.TWILIO_AUTH_TOKEN;
      const body  = new URLSearchParams({
        From: process.env.TWILIO_WHATSAPP_FROM,
        To:   process.env.TWILIO_WHATSAPP_TO,
        Body: msgNegocio,
      });
      const r = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
        {
          method:  'POST',
          headers: {
            'Authorization': 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
            'Content-Type':  'application/x-www-form-urlencoded',
          },
          body: body.toString(),
        }
      );
      results.whatsapp = r.ok ? 'ok' : `error ${r.status}`;
    } catch (e) {
      results.whatsapp = `exception: ${e.message}`;
    }
  }

  // Devolver resultado de cada canal (útil para depurar)
  return res.status(200).json({ sent: results });
}
