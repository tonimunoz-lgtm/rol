<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Rúnica — Panel del Master</title>
<link rel="stylesheet" href="/css/style.css" />
</head>
<body>

<div id="login-view" class="card" style="max-width:360px; margin:15vh auto; text-align:center;">
  <h1 class="display" style="font-size:1.4rem;">Acceso del Master</h1>
  <div class="field"><input id="login-email" type="email" placeholder="Email del master" /></div>
  <div class="field"><input id="login-pass" type="password" placeholder="Contraseña" /></div>
  <button id="login-btn" class="primary" style="width:100%;">Entrar</button>
  <p id="login-error" style="color:var(--rust); font-size:.85rem;"></p>
</div>

<div id="master-view" style="display:none;">

  <aside id="master-sidebar">
    <h2 class="display" style="font-size:1.1rem;">Rúnica · Master</h2>
    <nav>
      <a href="#" data-section="nueva-partida" class="active">Nueva partida</a>
      <a href="#" data-section="historia">Historia generada</a>
      <a href="#" data-section="personajes">Personajes</a>
      <a href="#" data-section="marcadores">Marcadores AR</a>
      <a href="#" data-section="en-vivo">Partida en vivo</a>
    </nav>
    <div style="margin-top:2em; font-size:.75rem; color:var(--parchment-dim);">
      Código actual:
      <div class="mono" id="codigo-partida-actual" style="color:var(--amber); font-size:1rem;">—</div>
    </div>
    <button id="logout-btn" class="danger" style="width:100%; margin-top:1.5em; font-size:.8rem;">Cerrar sesión</button>
  </aside>

  <main id="master-content">

    <!-- ---------- Wizard de creación de partida ---------- -->
    <section id="section-nueva-partida" class="section-panel active">
      <h2 class="display">Crea tu partida</h2>
      <p style="color:var(--parchment-dim); max-width:640px;">
        Responde estas preguntas y la IA generará una trama, PNJs, pistas y encuentros que luego
        podrás editar antes de jugar.
      </p>

      <div class="grid-2">
        <div class="field">
          <label>Nombre de la partida</label>
          <input id="w-nombre" placeholder="La Cripta del Río Helado" />
        </div>
        <div class="field">
          <label>Duración estimada</label>
          <select id="w-duracion">
            <option value="1-2 horas">1–2 horas</option>
            <option value="media tarde (3-4 horas)">Media tarde (3–4 h)</option>
            <option value="una jornada completa">Jornada completa</option>
            <option value="campaña de varias sesiones">Campaña de varias sesiones</option>
          </select>
        </div>
        <div class="field">
          <label>Dificultad</label>
          <select id="w-dificultad">
            <option value="introductoria">Introductoria</option>
            <option value="equilibrada">Equilibrada</option>
            <option value="exigente">Exigente</option>
            <option value="letal">Letal</option>
          </select>
        </div>
        <div class="field">
          <label>Nivel de trampas / enigmas</label>
          <select id="w-trampas">
            <option value="ninguna">Ninguna</option>
            <option value="pocas y evidentes">Pocas y evidentes</option>
            <option value="moderadas">Moderadas</option>
            <option value="muchas y retorcidas">Muchas y retorcidas</option>
          </select>
        </div>
        <div class="field">
          <label>Estilo narrativo</label>
          <input id="w-estilo" placeholder="Terror folclórico, fantasía épica, ciencia ficción..." />
        </div>
        <div class="field">
          <label>Tono</label>
          <select id="w-tono">
            <option value="serio y épico">Serio y épico</option>
            <option value="oscuro y tenso">Oscuro y tenso</option>
            <option value="humor y aventura ligera">Humor y aventura ligera</option>
            <option value="apto para todos los públicos">Apto para todos los públicos</option>
          </select>
        </div>
        <div class="field">
          <label>Ubicación temporal</label>
          <input id="w-epoca" placeholder="Hace 1000 años, año 2140, presente..." />
        </div>
        <div class="field">
          <label>Ubicación física / ambientación</label>
          <input id="w-lugar" placeholder="Bosque nórdico, nave espacial, castillo en ruinas..." />
        </div>
        <div class="field">
          <label>Tribus, razas o facciones presentes</label>
          <input id="w-facciones" placeholder="Clanes vikingos, elfos del hielo, corporaciones rivales..." />
        </div>
        <div class="field">
          <label>Número de jugadores</label>
          <input id="w-njugadores" type="number" min="1" max="20" value="6" />
        </div>
      </div>

      <button id="btn-generar" class="primary" style="margin-top:1em;">✨ Generar partida con IA</button>
      <p id="generar-status" style="color:var(--parchment-dim); font-size:.85rem;"></p>
    </section>

    <!-- ---------- Historia generada (editable) ---------- -->
    <section id="section-historia" class="section-panel">
      <h2 class="display">Historia y trama</h2>
      <div class="field">
        <label>Sinopsis / trama general</label>
        <textarea id="h-sinopsis" rows="6"></textarea>
      </div>
      <div class="field">
        <label>PNJs, pistas y encuentros generados (edítalos como quieras)</label>
        <textarea id="h-detalle" rows="14"></textarea>
      </div>
      <button id="btn-guardar-historia" class="primary">Guardar cambios</button>
    </section>

    <!-- ---------- Personajes ---------- -->
    <section id="section-personajes" class="section-panel">
      <h2 class="display">Personajes</h2>
      <div id="lista-personajes" class="grid-3"></div>
      <button id="btn-nuevo-personaje" style="margin-top:1em;">+ Nuevo personaje</button>
    </section>

    <!-- ---------- Marcadores AR ---------- -->
    <section id="section-marcadores" class="section-panel">
      <h2 class="display">Marcadores AR</h2>
      <p style="color:var(--parchment-dim);">
        1) Genera tu archivo <code>targets.mind</code> con el
        <a href="https://hiukim.github.io/mind-ar-js-doc/tools/compile" target="_blank">compilador oficial de MindAR</a>
        a partir de las fotos de tu sala. 2) Súbelo aquí. 3) Asocia cada marcador a su contenido.
      </p>
      <div class="field">
        <label>Subir targets.mind</label>
        <input id="upload-targets" type="file" accept=".mind" />
      </div>
      <div id="lista-marcadores" class="grid-2" style="margin-top:1em;"></div>
      <button id="btn-nuevo-marcador" style="margin-top:1em;">+ Asociar nuevo marcador</button>
    </section>

    <!-- ---------- Partida en vivo ---------- -->
    <section id="section-en-vivo" class="section-panel">
      <h2 class="display">Partida en vivo</h2>
      <div class="field">
        <label>Enviar narración a todos los jugadores</label>
        <textarea id="narracion-en-vivo" rows="3" placeholder="Describe lo que ocurre ahora..."></textarea>
        <button id="btn-lanzar-narracion" class="primary">📢 Lanzar a todos</button>
      </div>
      <h3>Jugadores conectados</h3>
      <div id="lista-jugadores-vivo" class="grid-2"></div>
    </section>

  </main>
</div>

<script type="module" src="/js/master.js"></script>
</body>
</html>
