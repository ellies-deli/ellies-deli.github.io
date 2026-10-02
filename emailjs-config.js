// Configuración de EmailJS (correo "your order is ready"). Ver la Parte 6 de la guía.
// Mientras diga PASTE_HERE, la página funciona igual pero no manda correos.
export const emailjsConfig = {
  publicKey: "PASTE_HERE",   // EmailJS > Account > General > Public Key
  serviceId: "PASTE_HERE",   // EmailJS > Email Services > Service ID (ej. service_abc123)
  templateId: "PASTE_HERE"   // EmailJS > Email Templates > Template ID (ej. template_xyz789)
};
