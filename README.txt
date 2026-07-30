GASTOS DE CASA — VERSIÓN FINAL PARA VERCEL

Esta es una aplicación web estática (HTML, CSS y JavaScript).
Por eso es correcto que la carpeta tenga pocos archivos: no necesita src/, Vite ni node_modules.

SUPABASE
- La URL y la clave pública ya están colocadas en config.js.
- El archivo schema.sql es el esquema de la base de datos.
- Si ya ejecutaste schema.sql en SQL Editor y viste “Success. No rows returned”, no lo ejecutes otra vez.

PUBLICAR EN VERCEL
1. Extraé este ZIP.
2. En Vercel: Nuevo proyecto.
3. Elegí “una carpeta”.
4. Seleccioná la carpeta Gastos_de_Casa_FINAL_PARA_VERCEL.
5. Vercel mostrará 8 archivos aproximadamente. Eso es correcto.
6. Poné como nombre del proyecto: gastos-de-casa.
7. Tocá Desplegar.

No hace falta agregar variables de entorno en Vercel porque esta versión usa config.js.
Nunca coloques una service_role key dentro de esta carpeta.
