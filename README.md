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

## Desplegar en Render con Blueprint

**El archivo `render.yaml` configura un Web Service de pago (`starter`) y un disco persistente de 1 GB. Revisa los cargos que muestre Render antes de crear los recursos.** El disco conserva SQLite entre reinicios y despliegues. Los discos persistentes requieren un servicio de pago; el sistema de archivos normal de Render es efímero. [Documentación de discos](https://render.com/docs/disks).

1. Sube el proyecto a GitHub siguiendo los pasos anteriores.
2. En Render, selecciona **New → Blueprint** y conecta el repositorio.
3. Render detectará `render.yaml`. Revisa el servicio y el disco y confirma su creación.
4. Cuando termine el despliegue, abre la URL HTTPS que Render asigna al servicio y crea tu cuenta.
5. Comprueba que `https://TU_SERVICIO.onrender.com/healthz` devuelve `{"ok":true}`.

El Blueprint configura:

| Opción | Valor |
| --- | --- |
| Runtime | Node |
| Build Command | `npm ci` |
| Start Command | `npm start` |
| Health Check Path | `/healthz` |
| NODE_ENV | `production` |
| DB_PATH | `/var/data/estadia.sqlite` |
| Disco | `/var/data`, 1 GB |
| Instancias | 1 |

También puedes crear **New → Web Service** manualmente con los mismos valores y agregar el disco desde las opciones del servicio. Deja **Root Directory vacío** si subiste el contenido de `estadia` como raíz del repositorio. Si el repositorio contiene una carpeta `estadia`, usa `estadia` como Root Directory; para Blueprint, selecciona además `estadia/render.yaml` como ruta del archivo y añade `rootDir: estadia` al servicio.

Render proporciona `PORT`, `RENDER` y `RENDER_EXTERNAL_URL` automáticamente. El servidor escucha en `0.0.0.0` en Render y usa la URL pública para validar el origen y emitir cookies `Secure`. No configures `APP_ORIGIN` con localhost en producción.

Los siguientes pushes a la rama conectada despliegan los cambios automáticamente. La aplicación mantiene una sola instancia porque usa una base SQLite local al disco.

### Dominio propio y variables opcionales

Para un dominio propio, configura `APP_ORIGIN` con su origen exacto, por ejemplo `https://estadistica.ejemplo.com`, sin barra final. Usa ese dominio para acceder a la aplicación.

`.env.example` documenta las variables opcionales. `npm start` lee las variables del entorno; para cargar un `.env` local explícitamente:

```sh
node --env-file=.env server.js
```

Para una demostración gratuita puedes crear un Web Service sin disco y dejar `DB_PATH` sin configurar, pero **las cuentas y conjuntos se perderán al reiniciar o desplegar**. El Blueprint incluido está preparado para conservar datos.

### Diagnóstico

- Si falla el inicio, revisa los logs y que Render use Node 22.17 o superior de la rama 22; `node:sqlite` debe estar disponible.
- Si aparece «Origen de solicitud inválido», revisa `APP_ORIGIN` y la URL desde la que abres la aplicación.
- Si desaparecen los datos, comprueba que el disco esté montado en `/var/data` y `DB_PATH` apunte a `/var/data/estadia.sqlite`.
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
