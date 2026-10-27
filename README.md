# SMG Soluciones Tecnológicas

Sitio web con formulario de contacto que **guarda cada solicitud en un archivo** y un **panel de administrador** para verlas.

## Estructura
- `server.js`: servidor (Node.js, sin dependencias). Guarda mensajes, valida el acceso de administrador y sirve el sitio.
- `public/index.html`: página principal.
- `public/admin.html`: acceso y panel de administrador.
- `public/css/styles.css`, `public/js/main.js`, `public/js/admin.js`: estilos y comportamiento.
- `data/mensajes.json`: **aquí se guardan las solicitudes** (se crea solo al recibir la primera).
- `.env.example`: copia como `.env` para cambiar puerto y credenciales.

## Cómo usarlo
1. Instala [Node.js](https://nodejs.org) 18 o superior.
2. En la carpeta del proyecto ejecuta: `npm start`
3. Abre http://localhost:3000

> Abre el sitio siempre desde esa dirección. Si abres `index.html` con doble clic o Live Server, el formulario no podrá guardar nada, porque necesita el servidor.

## Administrador
- Botón **Administrador** en el menú (o entra a `/admin.html`).
- Usuario: `Admin` — Contraseña: `Admin`
- Desde el panel ves las solicitudes, las actualizas y descargas todo en **CSV** (se abre en Excel).
- El usuario y la clave se validan en el servidor, no en el navegador. Hay límite de 5 intentos fallidos cada 15 minutos por conexión, y la sesión dura 2 horas.

### Importante antes de publicar en internet
`Admin / Admin` es muy fácil de adivinar. Para un sitio público:
1. Copia `.env.example` como `.env`.
2. Cambia `ADMIN_USER` y `ADMIN_PASS` por valores propios y largos.
3. Si el sitio va con HTTPS o detrás de un proxy, pon `TRUST_PROXY=1` y `COOKIE_SECURE=1`.

## Publicarlo
Necesitas un hosting que ejecute Node.js (Render, Railway, un VPS, etc.) y que conserve la carpeta `data/` entre reinicios (disco persistente). Los hostings solo de archivos estáticos (GitHub Pages, Netlify sin funciones) **no sirven** para esto.

## Copias de seguridad y privacidad
- Respalda `data/mensajes.json` periódicamente: ahí están los datos de tus clientes.
- Publica una política de privacidad y recoge solo los datos necesarios (revisa la normativa colombiana de protección de datos).

## Pendiente por personalizar
Cambia en `public/index.html` el correo, el teléfono y el horario de ejemplo por tus datos reales.
