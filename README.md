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
2. **Firestore Database** → créala en modo producción, región `europe-west1`. Firestore es
   gratis en el plan Spark, con cuotas diarias amplias — no hace falta Blaze para esto.
3. Despliega las reglas de Firestore sin CLI: Firestore Database → pestaña **"Reglas"** → borra
   lo que haya → pega el contenido de `firestore.rules` (está en este repo) → **Publicar**.

Ya **no hace falta crear un usuario master a mano**: cualquiera que abra `/master.html` puede
pulsar "¿No tienes cuenta todavía? Crea una" y registrarse con su propio email/contraseña. Cada
cuenta solo puede ver y editar sus propias partidas — lo controlan `firestore.rules`, comparando
el `uid` de quien pregunta con el campo `masterUid` guardado en cada partida.

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

## Paso 5 — Marcadores AR (MindAR), generados dentro de la propia app

Cada master genera y sube sus propios marcadores desde `/master.html` → "Marcadores AR", sin
tocar GitHub ni el compilador externo:

1. Haz una foto nítida y con buen contraste de cada zona/objeto de la sala (evita superficies
   lisas o repetitivas).
2. Súbelas en `/master.html` → "Marcadores AR", en el mismo orden en que quieres que salgan los
   índices (la 1ª foto = índice 0, la 2ª = índice 1, etc.).
3. Pulsa "Compilar y subir targets.mind": el motor de MindAR compila las fotos en tu propio
   navegador/móvil (usa la misma librería que el
   [compilador oficial](https://hiukim.github.io/mind-ar-js-doc/tools/compile), pero integrada en
   la app) y el resultado se sube automáticamente a Vercel Blob mediante
   `api/subir-marcador.js` — no hay paso manual.
4. Igual para los vídeos/imágenes que uses como contenido de cada marcador: se suben con su
   propio botón dentro del editor de cada marcador, en vez de pegar una ruta de GitHub.

Necesitas activar **Vercel Blob** una vez en tu proyecto (gratis en el plan Hobby): Vercel →
tu proyecto → pestaña **Storage** → "Create Database" → **Blob** → conéctalo al proyecto. Vercel
añade solo la variable de entorno `BLOB_READ_WRITE_TOKEN` que usa `api/subir-marcador.js`; no
hace falta copiarla a mano.

Límite a tener en cuenta: las funciones serverless de Vercel (plan Hobby) aceptan peticiones de
hasta ~4.5MB, así que desde esta pantalla se puede subir cualquier `targets.mind` o imagen sin
problema, pero un vídeo pesado puede no caber — en ese caso, aloja el vídeo en otro sitio (por
ejemplo YouTube sin listar, o tu propio Vercel Blob por otra vía) y pega la URL directamente en
el campo correspondiente.

La asociación fina "marcador índice N → vídeo/pista concreta" se hace igual que antes, desde la
lista de marcadores debajo del compilador.

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

## Motor de reglas automatizado (combate, habilidades, trampas)

- **Atributos que modifican las tiradas**: cada habilidad puede llevar un atributo asociado
  (fuerza, destreza, inteligencia, carisma, vigor). El modificador es el clásico de rol:
  `(valor del atributo − 10) / 2`, redondeado hacia abajo. Así, un personaje con más destreza
  falla menos las tiradas de habilidades ligadas a destreza (p. ej. un ladrón robando), sin nada
  que el master tenga que arbitrar a mano.
- **Habilidades marcadas como "ataque"**: al usarlas en combate, piden objetivo (otro jugador o
  un enemigo), tiran 1d20 + modificador contra una dificultad fija (12), y si aciertan, tiran el
  dado de daño de la habilidad + modificador y lo restan solas de la vida del objetivo. Todo con
  narración automática en el chat de todos.
- **Trampas** (marcador tipo "Trampa"): al escanearlas, tiran solas 1d20 + el atributo que elija
  el master contra la dificultad configurada. Si falla, aplica el daño automáticamente. No se
  repite si el mismo jugador vuelve a escanear el mismo marcador.
- **Objetos usados**: siguen aplicando su efecto (curar/dañar) solos, y ahora también generan una
  línea en el chat y pueden disparar el guion (ver siguiente sección).

## Guion automático (storyboard de escenas)

Desde `/master.html` → **Guion automático**, creas una secuencia de escenas. Cada escena tiene:

- Una narración que se lanza sola (texto + voz) en cuanto la escena se activa, en las pantallas
  de todos los jugadores.
- Un disparador que hace avanzar a la siguiente escena automáticamente: escanear un marcador
  concreto, recoger un objeto con un nombre concreto, **usar** un objeto con un nombre concreto,
  **usar** una habilidad con un nombre concreto, que un enemigo con un nombre concreto llegue
  a 0 de vida, que termine el combate en curso, o "solo cuando tú lo fuerces" (manual).

El propio juego, sin que el master tenga que estar pendiente, va detectando cuándo se cumple la
condición de la escena activa y pasa a la siguiente sola. El master siempre puede:
- **Forzar siguiente escena →**: por si algo no se dispara solo o quiere saltar manualmente.
- **Volver a la escena 1**: para reiniciar el guion sin tocar nada más.

Importante: el disparador `enemigo_derrotado` y `objeto` comparan el nombre **exactamente como lo
escribiste** en el enemigo/objeto (sin distinguir mayúsculas/minúsculas), así que usa el mismo
nombre en ambos sitios.

## Publicarlo en Google Play

La app sigue siendo una PWA (HTML/JS puro), así que para Google Play se empaqueta como
**Trusted Web Activity (TWA)**: un envoltorio Android muy fino que abre tu web ya desplegada en
pantalla completa, sin barra de navegador. No hay que reescribir nada de la app.

1. Instala [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) (`npm i -g @bubblewrap/cli`).
2. `bubblewrap init --manifest=https://tu-dominio.vercel.app/manifest.json` — genera el proyecto
   Android a partir de tu PWA ya publicada.
3. `bubblewrap build` genera el `.aab` que subes a la Play Console.
4. Google Play exige verificar que el dominio es tuyo (Digital Asset Links): Bubblewrap te genera
   un archivo `assetlinks.json` que debes servir en
   `https://tu-dominio.vercel.app/.well-known/assetlinks.json`.

Cada actualización de tu web en Vercel se refleja sola en la app instalada (es la misma URL);
solo hace falta volver a publicar en Play si cambias el propio envoltorio Android (icono, nombre,
versión mínima, etc.), no por cambios normales de contenido o código.

## Siguientes pasos sugeridos

- Ramificaciones (que una escena pueda llevar a distintas escenas siguientes según lo que pase,
  no solo una secuencia lineal).
- Que la IA proponga un primer borrador de guion junto con la historia.
- Sonido ambiente por escena (variarlo según la ubicación, no solo una pista fija).
- Resolución de daño con más matices (tipos de daño, resistencias, curación en área).
