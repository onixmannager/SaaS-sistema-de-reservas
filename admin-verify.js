// api/admin-verify.js — Vercel Serverless Function
// Verifica la contraseña del administrador contra la variable de entorno.
//
// Variable necesaria en Vercel:
//   ADMIN_PASSWORD   (la contraseña que usará el admin para entrar al panel)

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ error: 'Contraseña requerida.' });
  }

  if (!process.env.ADMIN_PASSWORD) {
    console.error('Variable de entorno ADMIN_PASSWORD no configurada.');
    return res.status(500).json({ error: 'Configuración incompleta.' });
  }

  if (password === process.env.ADMIN_PASSWORD) {
    return res.status(200).json({ ok: true });
  } else {
    return res.status(401).json({ ok: false, error: 'Contraseña incorrecta.' });
  }
}
