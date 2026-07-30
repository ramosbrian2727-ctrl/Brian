GASTOS DE CASA PRO v4 - UN SOLO ADMINISTRADOR

1. Ejecutá ACTUALIZACION_SUPABASE_v4_UN_SOLO_ADMIN.sql en Supabase > SQL Editor.
2. Subí a GitHub los archivos SUELTOS de esta carpeta, reemplazando los anteriores.
3. Vercel publicará automáticamente.
4. Actualizá la app con Ctrl + F5.

Cambios:
- Solo el propietario del grupo puede ser administrador.
- Los demás roles son Editor, Colaborador o Espectador.
- Los usuarios nuevos no pueden crear otro grupo.
- Solo pueden solicitar acceso y esperar tu aprobación.
- Se corrige la carga de Usuarios autorizados sin depender del JOIN que daba error.

IMPORTANTE:
Esta actualización no elimina el segundo grupo que ya fue creado. Lo deja aislado.
Para borrar ese grupo sin tocar el tuyo, primero hay que identificar cuál es el correcto.
