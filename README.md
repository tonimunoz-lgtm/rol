# Rúnica — Juego de rol colaborativo con AR por marcadores

PWA en HTML/JS puro (sin build) + Firebase (Spark, gratis) + Gemini API vía Vercel + Web Speech API.
100% gratuito: no requiere plan Blaze de Firebase ni tarjeta de crédito en ningún servicio.

## Estructura

```
index.html              → vista jugador (cámara AR con MindAR)
master.html             → panel del master (crea partida, marcadores, narración en vivo)
manifest.json           → PWA instalable
service-worker.js       → cache offline del shell
css/style.css           → sistema de diseño
js/firebase-config.js
js/app.js                → lógica jugador
js/master.js             → lógica master
api/generar-partida.js   → función serverless de Vercel que llama a Gemini (la key vive aquí, no en el cliente)
package.json             → dependencias de la función serverless
firestore.rules
firebase.json
icons/                   → logo generado (icon-192.png, icon-512.png, icon-maskable-512.png)
```

## Paso 1 — Subir el repo a GitHub

Sube todos los archivos de este proyecto a la raíz de tu repositorio (no dentro de una subcarpeta).
Si usas la web de GitHub: "Add file" → "Upload files" → arrastra todo el contenido descomprimido.
Si usas terminal:
```bash
cd rol-ar-game
git add -A
git commit -m "Base del proyecto"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
git push -u origin main --force
```

## Paso 2 — Conectar con Vercel

Con `rol-gamma.vercel.app` ya creado, apúntalo a este repo (Vercel → Project Settings → Git →
conectar repositorio). Es HTML/JS puro: sin build command, sin output directory especial. Cada
push a `main` despliega automáticamente, y `api/generar-partida.js` se detecta solo como función
serverless.

## Paso 3 — Firebase: Auth y Firestore (plan gratuito Spark, sin Storage ni Blaze)

En la consola de Firebase del proyecto `femjoc`:

1. **Authentication** → Sign-in method → habilita **Anónimo** y **Email/contraseña**.
2. **Authentication** → Users → "Add user" → crea tu usuario master (email + contraseña).
3. **Firestore Database** → créala en modo producción, región `europe-west1`. Firestore es
   gratis en el plan Spark, con cuotas diarias amplias — no hace falta Blaze para esto.
4. Copia el **UID** de tu usuario master (pestaña Users) y crea a mano un documento:
   Firestore → "Start collection" → ID: `masters` → ID del documento: pega tu UID → guarda vacío.
5. Despliega las reglas de Firestore sin CLI: Firestore Database → pestaña **"Reglas"** → borra
   lo que haya → pega el contenido de `firestore.rules` (está en este repo) → **Publicar**.

No usamos Firebase Storage ni Cloud Functions en absoluto, así que no hace falta el plan Blaze
para nada de este proyecto.

## Paso 4 — La IA (Groq) vía función serverless de Vercel

La llamada a la IA vive en `api/generar-partida.js`, que Vercel detecta automáticamente como
función serverless (gratis en el plan Hobby, sin CLI, sin cuentas de servicio). Usamos **Groq**
en vez de Gemini: tier gratuito generoso, sin tarjeta, y autenticación estándar sin los
problemas de formato de clave que está teniendo Gemini ahora mismo.

1. Crea una cuenta en [console.groq.com](https://console.groq.com).
2. **API Keys** → "Create API Key" → cópiala (empieza por `gsk_...`).
3. En tu proyecto de Vercel (`rol-gamma`) → **Settings → Environment Variables**.
4. Añade una variable:
   - Nombre: `GROQ_API_KEY`
   - Valor: tu clave de Groq
   - Entorno: Production (y Preview si quieres probar en ramas)
5. Guarda y haz un **Redeploy** (Deployments → los tres puntos del último deploy → "Redeploy"),
   para que la función serverless recoja la variable nueva.

`js/master.js` ya llama a `/api/generar-partida` (misma URL de tu web, sin problemas de CORS), y
la función verifica que quien pregunta es tu usuario master consultando Firestore con su propio
token de sesión — sin necesitar credenciales adicionales.

> **Nota histórica**: al principio usamos Gemini, pero Google está en medio de una migración de
> formato de claves (de `AIza...` a `AQ...`) que ahora mismo está rompiendo la autenticación para
> muchos desarrolladores nuevos — ver los reportes en el foro oficial de Google AI. Si en el
> futuro Google lo arregla y prefieres volver a Gemini, el cambio en `api/generar-partida.js` es
> mínimo (cambiar la URL y la cabecera de autenticación).

## Paso 5 — Marcadores AR (MindAR), sin Firebase Storage

Los archivos de marcadores (`targets.mind` y, más adelante, vídeos/imágenes) se sirven como
archivos estáticos directamente desde el repositorio — Vercel los sirve gratis, igual que
`index.html`.

1. Haz una foto nítida y con buen contraste de cada zona/objeto de la sala (evita superficies
   lisas o repetitivas).
2. Ve al [compilador oficial de MindAR](https://hiukim.github.io/mind-ar-js-doc/tools/compile),
   sube todas las fotos juntas y descarga el `targets.mind` resultante (un único archivo sirve
   para varios marcadores, cada uno con un índice 0, 1, 2...).
3. Súbelo a tu repo de GitHub, dentro de una carpeta nueva `/marcadores/` en la raíz
   (GitHub → "Add file" → "Upload files").
4. Desde `/master.html` → "Marcadores AR", pega la ruta (`/marcadores/targets.mind`) y guarda.

La asociación fina "marcador índice N → vídeo/pista concreta" es la siguiente pieza a construir
(ahora mismo el escaneo ya detecta los marcadores del `targets.mind`, pero todos disparan el
mismo comportamiento genérico).

## Paso 6 — Sistema de fichas de personaje y habilidades

Desde `/master.html` → **Personajes**:

1. Crea una plantilla por cada personaje jugable: nombre, raza, clase, descripción, atributos
   (fuerza, destreza, vigor, inteligencia, carisma) y vida base.
2. Añade tantas habilidades como quieras a cada personaje: nombre, tipo (activa/pasiva), dado
   asociado (d4–d20), usos por partida (0 = ilimitado) y descripción del efecto.
3. Cuando un jugador se une con el código de partida, verá la lista de personajes disponibles
   (los ya elegidos por otro jugador aparecen bloqueados) y podrá elegir el suyo.
4. En su móvil, el jugador tiene un botón **"📜 Ficha"** con sus atributos y sus habilidades.
   Las habilidades activas tienen un botón "Usar" que descuenta usos, tira el dado asociado si
   lo tiene, y lo registra en el log de la partida que ve el master en tiempo real.

Crea tantas plantillas como jugadores esperas tener (o más, para que puedan elegir).

## Paso 7 — Probarlo

- Jugador: abre `https://rol-gamma.vercel.app/` en el móvil, introduce el código de partida que
  te dé el master.
- Master: abre `https://rol-gamma.vercel.app/master.html`, inicia sesión, rellena el wizard y
  pulsa "Generar partida con IA".

## Sobre las claves

- `firebaseConfig` en `js/firebase-config.js` es pública por diseño — no pasa nada por que esté
  en el código del cliente. La seguridad real la da `firestore.rules`.
- La API key de Groq se guarda como **variable de entorno en Vercel** (`GROQ_API_KEY`), no en
  el código ni en el repositorio. Solo la lee `api/generar-partida.js`, que corre en el servidor
  — nunca llega al navegador. Si quieres rotarla, cambia el valor en Vercel y haz Redeploy.

## Imágenes de ambientación (Pexels) + chat en pantalla

La pantalla del jugador, mientras no está escaneando, muestra un fondo con fotos libres de
derechos relacionadas con el lugar/estilo/época de la partida (rotan solas cada pocos segundos),
buscadas automáticamente vía Pexels. Encima, un chat transparente sin cajas (estilo overlay de
stream) muestra lo que escriben los demás jugadores y el master, cada uno con su color, y las
líneas van desapareciendo solas tras unos segundos.

La cámara AR **no se abre sola**: el jugador pulsa "🔍 Inspeccionar" para activarla (y "✕ Cerrar
cámara" para volver al fondo ambiental); el chat se queda superpuesto también mientras se escanea.

1. Crea una cuenta gratuita en [pexels.com/api](https://www.pexels.com/api/) y copia tu API key.
2. En Vercel → Settings → Environment Variables, añade `PEXELS_API_KEY` con esa clave → Redeploy.

Si no la configuras, simplemente no habrá fondo (queda el color oscuro base); el resto de la app
sigue funcionando igual.

## Voz IA opcional (ElevenLabs)

Por defecto se usa la voz del dispositivo (Web Speech API, gratis, ilimitada). Si quieres probar
una voz más expresiva, cada jugador puede tocar el botón 🔊/🎙️ arriba a la derecha para cambiar
a "Voz IA" (ElevenLabs). Para activarla:

1. Crea una cuenta en [elevenlabs.io](https://elevenlabs.io) (tier gratuito, cuota mensual de
   caracteres limitada).
2. Copia tu API key (perfil → API Keys).
3. En Vercel → Settings → Environment Variables, añade `ELEVENLABS_API_KEY` con esa clave →
   Redeploy.

Si no configuras esta variable, el botón simplemente no hace nada especial y todo sigue
funcionando con la voz del dispositivo.

## Siguientes pasos sugeridos

- Sonido ambiente por escena (variarlo según la ubicación, no solo una pista fija).
- Resolución de daño con más matices (tipos de daño, resistencias, curación en área).
