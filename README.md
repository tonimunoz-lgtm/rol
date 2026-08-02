# Rúnica — Juego de rol colaborativo con AR por marcadores

PWA en HTML/JS puro (sin build) + Firebase + Gemini API + Web Speech API, desplegable en Vercel.

## Estructura

```
index.html          → vista jugador (cámara AR con MindAR)
master.html          → panel del master (crea partida, marcadores, narración en vivo)
manifest.json        → PWA instalable
service-worker.js    → cache offline del shell
css/style.css        → sistema de diseño
js/firebase-config.js
js/app.js             → lógica jugador
js/master.js          → lógica master
functions/index.js    → Cloud Function que llama a Gemini (la key vive aquí, no en el cliente)
firestore.rules
storage.rules
firebase.json
icons/                → logo generado (icon-192.png, icon-512.png, icon-maskable-512.png)
```

## Paso 1 — Subir el repo a GitHub

```bash
cd rol-ar-game
git add .
git commit -m "Base inicial: PWA + AR + Firebase + wizard IA"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/rol-ar-game.git
git push -u origin main
```

## Paso 2 — Conectar con Vercel

Como ya tienes `rol-gamma.vercel.app`, solo tienes que apuntar ese proyecto de Vercel a este repo de GitHub (Vercel → Project Settings → Git → conectar repositorio). Al ser HTML/JS puro, Vercel no necesita build command ni output directory: sirve `index.html` directamente. Cada `git push` a `main` desplegará automáticamente.

## Paso 3 — Firebase: Auth, Firestore y Storage

En la consola de Firebase del proyecto `femjoc`:

1. **Authentication** → habilita **Anónimo** (para jugadores) y **Email/contraseña** (para el master).
2. Crea manualmente tu usuario master (Authentication → Add user).
3. **Firestore Database** → créala en modo producción, región `europe-west1`.
4. **Storage** → actívalo, misma región.
5. Despliega las reglas incluidas:
   ```bash
   npm install -g firebase-tools
   firebase login
   firebase use femjoc
   firebase deploy --only firestore:rules,storage:rules
   ```
6. **Muy importante**: para que tu usuario master tenga permisos, crea a mano en Firestore un documento en la colección `masters` con el **UID de tu usuario** como ID del documento (puede estar vacío, solo debe existir). Lo ves en Authentication → tu usuario → UID.

## Paso 4 — Cloud Function con Gemini (la IA que genera la partida)

1. Consigue tu API key de Gemini en [Google AI Studio](https://aistudio.google.com/app/apikey) (**genera una nueva**, no reutilices la que pegaste antes en el chat).
2. Guarda la key como secreto de Firebase (nunca en el código):
   ```bash
   firebase functions:secrets:set GEMINI_API_KEY
   ```
3. Instala dependencias y despliega:
   ```bash
   cd functions
   npm install
   cd ..
   firebase deploy --only functions
   ```
4. Copia la URL que te da el deploy y pégala en `js/master.js`, constante `GENERAR_PARTIDA_URL`.

## Paso 4b — Sistema de fichas de personaje y habilidades

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

## Paso 5 — Marcadores AR (MindAR)

1. Haz una foto nítida y con buen contraste de cada zona/objeto de la sala que quieras convertir en marcador (evita superficies lisas o repetitivas).
2. Ve al [compilador oficial de MindAR](https://hiukim.github.io/mind-ar-js-doc/tools/compile), sube todas las fotos juntas y descarga el `targets.mind` resultante (un único archivo sirve para varios marcadores, cada uno con un índice 0, 1, 2...).
3. Desde el panel del master (`/master.html` → "Marcadores AR"), sube ese `targets.mind`.
4. Asocia cada índice de marcador a su contenido (vídeo, imagen, texto, pista) — esta parte de asociación fina la iteramos en el siguiente paso de desarrollo, ahora mismo el scaffold ya carga la escena AR y detecta los marcadores.

## Paso 6 — Probarlo

- Jugador: abre `https://rol-gamma.vercel.app/` en el móvil, introduce el código de partida que te dé el master.
- Master: abre `https://rol-gamma.vercel.app/master.html`, inicia sesión, rellena el wizard y pulsa "Generar partida con IA".

## Sobre las claves

- `firebaseConfig` en `js/firebase-config.js` es pública por diseño — no pasa nada por que esté en el código del cliente. La seguridad real la dan `firestore.rules` y `storage.rules`.
- La API key de Gemini **nunca** debe estar en el frontend. Vive solo en `functions/index.js`, como secreto de Firebase.
- La clave que pegaste en el chat (`AQ.Ab8...`) no la he usado en ningún archivo — regenérala desde su consola de origen si es una clave de API real.

## Siguientes pasos sugeridos

- Editor visual en el panel master para arrastrar cada foto-marcador y asignarle vídeo/pista sin tocar Firestore a mano.
- Ficha de personaje completa (habilidades, clases, inventario con objetos reales).
- Sistema de combate por turnos sincronizado entre los 20 jugadores.
- Mejorar la voz con ElevenLabs (tier gratuito limitado) si Web Speech API se queda corta en expresividad.
