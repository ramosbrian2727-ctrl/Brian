GASTOS DE CASA PRO v3 - ACCESO PRIVADO

1) Ejecutá en Supabase el archivo:
   ACTUALIZACION_SUPABASE_v3_ACCESO_PRIVADO.sql

2) Después subí TODOS los archivos de esta carpeta a tu repositorio de GitHub,
   reemplazando los anteriores.

3) Confirmá el cambio (Commit changes). Vercel publicará la actualización automáticamente.

NUEVA SEGURIDAD:
- Compartir el enlace no concede acceso.
- Registrarse no concede acceso.
- El código solo envía una solicitud.
- El administrador aprueba o rechaza desde Configuración > Usuarios y permisos.
- Hasta la aprobación, el usuario no ve gastos, saldos, personas ni movimientos.

No compartas claves secretas o service_role. config.js utiliza únicamente la clave pública.
