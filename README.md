# Estadia

Laboratorio de estadística con registro, inicio de sesión y conjuntos de datos privados. La interfaz y la API se sirven desde el mismo proceso Node.js, y los datos se almacenan en SQLite.

## Ejecutar en tu computadora

Necesitas Node.js **22.17 o superior de la rama 22**, con npm. La versión de despliegue se selecciona con `.node-version`.

Desde la carpeta `estadia`:

```sh
npm ci
npm start
```

Abre <http://localhost:3000>. La base de datos se crea automáticamente en `data/estadia.sqlite`. Crea una cuenta desde la interfaz; la contraseña debe tener entre 12 y 128 caracteres.

```sh
npm run dev  # Reinicia el servidor al editar archivos
npm test     # Prueba HTTP con una base de datos temporal, sin modificar tus datos
```

El proyecto usa módulos integrados de Node.js, incluido `node:sqlite`, y no necesita dependencias externas ni compilación. En Node 22 puede aparecer un aviso de que SQLite es experimental.

## Subir a GitHub

La raíz del repositorio es **esta carpeta `estadia`**, donde están `package.json` y `render.yaml`.

1. Crea un repositorio vacío en GitHub, sin agregar README, licencia ni `.gitignore` desde GitHub.
2. Desde `estadia`, ejecuta:

```sh
git status
git add .
git commit -m "Preparar Estadia para GitHub y Render"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/TU_REPOSITORIO.git
git push -u origin main
```

Sustituye `TU_USUARIO` y `TU_REPOSITORIO` por tus valores. Esta carpeta ya tiene Git inicializado. Si `origin` ya existe, consulta `git remote -v` antes de añadirlo o cambiarlo.

`.gitignore` excluye la base de datos, archivos `.env`, dependencias y archivos locales. Los usuarios y conjuntos guardados en tu computadora no se suben a GitHub ni se transfieren automáticamente a Render.

GitHub Actions ejecutará `npm ci` y `npm test` con cada push y pull request.

## Desplegar gratis en Render con Blueprint

**El archivo `render.yaml` configura un Web Service en el plan Free, sin disco persistente.** SQLite es temporal: las cuentas, sesiones y conjuntos se pierden cuando el servicio se suspende, reinicia o se vuelve a desplegar. Render suspende los servicios Free tras 15 minutos sin tráfico; la siguiente visita puede tardar aproximadamente un minuto en cargar. [Limitaciones del plan Free](https://render.com/docs/free).

1. Sube el proyecto a GitHub siguiendo los pasos anteriores.
2. En Render, selecciona **New → Blueprint** y conecta el repositorio.
3. Usa la rama `main` y la ruta `render.yaml`. Revisa que el servicio indique el plan **Free**, sin disco, y pulsa **Deploy Blueprint**.
4. Cuando termine el despliegue, abre la URL HTTPS que Render asigna al servicio y crea tu cuenta.
5. Comprueba que `https://TU_SERVICIO.onrender.com/healthz` devuelve `{"ok":true}`.

El Blueprint configura:

| Opción | Valor |
| --- | --- |
| Runtime | Node |
| Plan | Free |
| Build Command | `npm ci` |
| Start Command | `npm start` |
| Health Check Path | `/healthz` |
| NODE_ENV | `production` |
| DB_PATH | `./data/estadia.sqlite` (temporal) |
| Disco persistente | Ninguno |
| Instancias | 1 |

También puedes crear **New → Web Service** manualmente con los mismos valores y seleccionar **Free** como Instance Type, sin agregar un disco. Deja **Root Directory vacío** si subiste el contenido de `estadia` como raíz del repositorio. Si el repositorio contiene una carpeta `estadia`, usa `estadia` como Root Directory; para Blueprint, selecciona además `estadia/render.yaml` como ruta del archivo y añade `rootDir: estadia` al servicio.

Render proporciona `PORT`, `RENDER` y `RENDER_EXTERNAL_URL` automáticamente. El servidor escucha en `0.0.0.0` en Render y usa la URL pública para validar el origen y emitir cookies `Secure`. No configures `APP_ORIGIN` con localhost en producción.

Los siguientes pushes a la rama conectada despliegan los cambios automáticamente. La aplicación usa una sola instancia con SQLite local y temporal en Render Free.

### Dominio propio y variables opcionales

Para un dominio propio, configura `APP_ORIGIN` con su origen exacto, por ejemplo `https://estadistica.ejemplo.com`, sin barra final. Usa ese dominio para acceder a la aplicación.

`.env.example` documenta las variables opcionales. `npm start` lee las variables del entorno; para cargar un `.env` local explícitamente:

```sh
node --env-file=.env server.js
```

Para conservar los datos a largo plazo será necesario adaptar la aplicación a una base externa o usar un servicio de pago con disco persistente. El Blueprint incluido utiliza únicamente el servicio Free. Si ya habías creado recursos de pago, revisa esos recursos en Render: cambiar este archivo no elimina automáticamente un disco existente.

### Diagnóstico

- Si falla el inicio, revisa los logs y que Render use Node 22.17 o superior de la rama 22; `node:sqlite` debe estar disponible.
- Si aparece «Origen de solicitud inválido», revisa `APP_ORIGIN` y la URL desde la que abres la aplicación.
- Si desaparecen los datos en Render Free, es el comportamiento esperado al suspender, reiniciar o desplegar el servicio: SQLite está en almacenamiento temporal.
- El límite de intentos utiliza la IP del socket. Detrás del proxy de Render algunos visitantes pueden compartir ese límite y recibir un bloqueo de 15 minutos tras varios intentos fallidos.

## Archivos principales

- `server.js`: servidor HTTP, archivos públicos, conexión SQLite y cierre ordenado.
- `api.js`: autenticación, sesiones y operaciones de conjuntos de datos.
- `schema.js`: esquema inicial de SQLite.
- `index.html`, `dashboard.html`, `styles.css`, `app.js`: interfaz.
- `stats.js`: validaciones y cálculos estadísticos compartidos.
- `render.yaml`: configuración de infraestructura para Render.
- `test/deployment.test.js`: verifica archivos públicos, protección de archivos internos, sesión HTTPS, operaciones de conjuntos y persistencia tras reiniciar.

Referencias: [despliegue Node.js](https://render.com/docs/deploy-node-express-app), [Blueprints](https://render.com/docs/blueprint-spec), [versión de Node.js](https://render.com/docs/node-version).
