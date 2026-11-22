/* The interior designer in the 3D walk, and "Reimagine".

   Redesign opens the design tools (Arrange furniture, Paint and wallpaper), which are tucked away otherwise.
   Reimagine sits under it, always there (it glows once something has been changed): it renders the
   room as it now looks in the walk, from where you're standing, and sends that with the room's original photo to the backend
   (POST /reimagine), which asks Google's Gemini image model for a photographic version of the redesign in the real room (its
   walls, windows, view and light come from the photo). Inside Veduta the request goes through the website;
   on its own the tour needs TOUR_CONFIG.API_URL (config.js) to point at the backend. */
(function () {
  const T = window.Tour;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  let changedOnce = false;   // survives rebuilds of the walk within the page
  T.on("tour:design-changed", () => (changedOnce = true), { persistent: true });

  // a canvas or image as a JPEG data: URL, no bigger than max on its longer side
  const toJpeg = (src, max = 1280) => {
    const w = src.naturalWidth || src.width, h = src.naturalHeight || src.height, k = Math.min(1, max / Math.max(w, h));
    const c = document.createElement("canvas"); c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.9);
  };
  // Is this picture (nearly) the same as the render? Compared small and grey, so size and compression don't count.
  // Checked here as well as on the server, so a result that's just the design sent back is never passed off as new.
  const sameAsRender = (renderUrl, resultUrl) => new Promise((resolve) => {
    const load = (src) => new Promise((ok) => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => ok(im); im.onerror = () => ok(null); im.src = src; });
    Promise.all([load(renderUrl), load(resultUrl)]).then(([a, b]) => {
      if (!a || !b) return resolve(false);
      try {
        const grey = (im) => { const c = document.createElement("canvas"); c.width = 96; c.height = 64; const g = c.getContext("2d"); g.drawImage(im, 0, 0, 96, 64);
          const d = g.getImageData(0, 0, 96, 64).data, out = new Float32Array(96 * 64); for (let i = 0; i < out.length; i++) out[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; return out; };
        const ga = grey(a), gb = grey(b); let sum = 0; for (let i = 0; i < ga.length; i++) sum += Math.abs(ga[i] - gb[i]);
        resolve(sum / ga.length < 7);
      } catch (e) { resolve(false); }   // a picture from a server that doesn't allow reading it back
    });
  });
  const plainError = (e) => {
    let m = (e && e.message) || String(e || "");
    try { const j = JSON.parse(m); if (j && j.detail) m = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail); } catch (_) { /* not JSON */ }
    return m || "Google couldn’t reimagine the room just now. Try again.";
  };

  // ---- what's in the picture, in words, for the image model ----
  const LABEL = {
    sofa: "sofa", armchair: "armchair", ottoman: "upholstered ottoman", coffeeRound: "round coffee table", coffee: "coffee table",
    sideboard: "sideboard", tv: "TV wall unit with a television", shelving: "shelving unit", bookcase: "bookcase", table: "dining table",
    roundTable: "round dining table", chair: "chair", island: "kitchen island", counter: "run of kitchen units with a worktop",
    bed: "double bed", nightstand: "bedside table", bench: "bench", dresser: "chest of drawers", wardrobe: "built-in wardrobe",
    desk: "desk with a chair", console: "console table", bath: "bath", vanity: "basin on a vanity unit", wc: "WC", shower: "walk-in shower with a glass screen",
    floorLamp: "floor lamp", roundShelf: "round side table", plant: "potted plant", rug: "rug", lounger: "sun lounger", planter: "planter",
    hottub: "hot tub", art: "framed picture on the wall",
  };
  const COLOURS = [
    ["white", "#f5f5f2"], ["ivory", "#efe9df"], ["cream", "#e8dcc3"], ["beige", "#d8c8ad"], ["oatmeal", "#cdbfa9"], ["taupe", "#b7aa94"],
    ["light grey", "#cfcfcf"], ["grey", "#9a9a9a"], ["charcoal", "#3b3a38"], ["black", "#151515"], ["tan", "#b58a5a"], ["brown", "#6b4a32"],
    ["walnut brown", "#5a4a3c"], ["terracotta", "#b5603f"], ["rust", "#a0522d"], ["red", "#b22222"], ["burgundy", "#7a2b24"],
    ["pink", "#e7a6b3"], ["blush pink", "#d9a79a"], ["magenta", "#b0207a"], ["purple", "#6a3d8f"], ["lavender", "#b7a6d6"],
    ["navy", "#2c3550"], ["blue", "#2f5bea"], ["sky blue", "#8cbbe8"], ["teal", "#1f6b78"], ["turquoise", "#2ab3b0"],
    ["green", "#3d7a46"], ["sage green", "#a9b59c"], ["forest green", "#2f5546"], ["olive", "#7a7a3a"], ["mustard", "#c9a24a"],
    ["yellow", "#e6c84a"], ["orange", "#e07b2a"], ["gold", "#c49a4c"], ["royal blue", "#1d4f86"],
    ["mocha brown", "#8a7560"], ["chocolate brown", "#4a3426"], ["camel", "#b98d5c"], ["sand", "#d9c7a3"], ["stone grey", "#a8a096"],
  ].map(([n, h]) => [n, [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))]);
  // what each piece looks like when it has no colour of its own (the 3D walk's defaults, furnish2.js)
  const DEFAULT_COLOUR = { sofa: "#e6dfd2", armchair: "#d7ccbb", ottoman: "#1f6b78", sideboard: "#1d4f86", rug: "#e8e2d7", bed: "#b7aa94", nightstand: "#15100d" };
  const FINISH = {
    sofa: "on dark oak legs", armchair: "with dark oak legs", sideboard: "with brass handles", nightstand: "in black gloss with brass handles",
    chair: "in dark oak", coffeeRound: "in black gloss with a brass base", shelving: "in oak and dark wood", bookcase: "in dark wood, filled with books",
    floorLamp: "in brass with a white shade", tv: "in dark oak", console: "in dark oak with brass details", dresser: "in dark oak with brass handles",
    desk: "in dark oak", wardrobe: "in off-white lacquer with brass handles", counter: "in pale grey with a white marble worktop",
    island: "in charcoal lacquer with a white marble top and brass stools", bench: "upholstered in beige on dark oak legs",
    roundShelf: "in dark oak and marble", bath: "in white enamel with a travertine panel", vanity: "in dark oak with a travertine top",
    wc: "in white ceramic", shower: "with a white tray", bed: "with white bedding",
  };
  const colourName = (hex) => {
    if (typeof hex !== "string" || !/^#[0-9a-f]{6}$/i.test(hex)) return "";
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    let best = "", d = Infinity;
    for (const [n, k] of COLOURS) {   // weighted RGB distance: close enough to how colours are named
      const rm = (c[0] + k[0]) / 2, dr = c[0] - k[0], dg = c[1] - k[1], db = c[2] - k[2];
      const e = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
      if (e < d) { d = e; best = n; }
    }
    return best;
  };
  // Each piece of furniture you can see from the camera: "a teal sofa, centre left, in the middle distance".
  function furnitureInView(P, camera, scene, furniture, THREE) {
    if (!THREE || !P.furnishing) return [];
    const s = P.model.metresPerPx, ray = new THREE.Raycaster(), out = [];
    const isFurniture = (o) => { for (let x = o; x; x = x.parent) if (x === furniture) return true; return false; };
    const camPos = camera.getWorldPosition(new THREE.Vector3());
    for (const it of P.furnishing) {
      const label = LABEL[it.type];
      if (!label) continue;
      // several points on the piece (its middle and round its edges, low and higher up): it's in the picture if
      // any of them is in frame with no wall in the way, so pieces cut off by the frame's edge count too
      const h = it.type === "art" ? (it.elev || 1.5) : it.type === "rug" ? 0.02 : (it.elev || 0) + 0.4;
      const r = it.type === "art" ? 0.25 : it.type === "rug" ? Math.min(1.2, ((it.w || 2) + (it.d || 1.6)) / 4) : 0.4;
      const pts = [[0, 0]].concat([0, 1, 2, 3, 4, 5, 6, 7].map((k) => [Math.cos((k * Math.PI) / 4) * r, Math.sin((k * Math.PI) / 4) * r]));
      const seen = [];
      for (const [dx, dz] of pts) for (const hh of it.type === "rug" || it.type === "art" ? [h] : [h - 0.15, h + 0.3]) {
        const p = new THREE.Vector3(it.x * s + dx, Math.max(0.02, hh), it.y * s + dz), ndc = p.clone().project(camera);
        if (ndc.z > 1 || ndc.z < -1 || Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) continue;
        const dist = camPos.distanceTo(p);
        ray.set(camPos, p.clone().sub(camPos).normalize()); ray.far = dist;
        if (ray.intersectObjects(scene.children, true).some((x) => x.object.visible && !isFurniture(x.object) && x.distance < dist - 0.3 && x.object.type !== "Sprite")) continue;
        seen.push({ x: ndc.x, dist });
      }
      if (!seen.length) continue;   // out of frame, or behind a wall
      const ndc = { x: seen.reduce((a, q) => a + q.x, 0) / seen.length }, dist = seen.reduce((a, q) => a + q.dist, 0) / seen.length;
      const col = colourName(it.color || (it.type === "chair" ? it.chairColor : null) || DEFAULT_COLOUR[it.type]);
      let what = label;
      if (it.type === "table" || it.type === "roundTable") {
        const n = it.type === "table" ? (it.chairs ?? 3) * 2 : (it.chairs ?? 4);
        what = `${label}${n ? ` with ${n} ${colourName(it.chairColor) ? colourName(it.chairColor) + " " : ""}chairs` : ""}`;
      } else if (col) what = `${col} ${label}`;
      if (FINISH[it.type]) what += ` ${FINISH[it.type]}`;
      // cushions in their own colours
      const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);
      const cush = [...list(it.cushion), ...list(it.cushions), ...list(it.accent)].map(colourName).filter(Boolean);
      const names = [...new Set(cush)];
      if (names.length === 1 && cush.length === 1) what += `, with a ${names[0]} cushion`;
      else if (names.length) what += `, with ${names.length > 1 ? names.slice(0, -1).join(", ") + " and " + names[names.length - 1] : names[0]} cushions`;
      const x = ndc.x, where = x < -0.45 ? "on the left" : x < -0.15 ? "centre left" : x <= 0.15 ? "in the centre" : x <= 0.45 ? "centre right" : "on the right";
      const depth = dist < 2.2 ? "in the foreground" : dist < 4.5 ? "in the middle distance" : "at the back";
      out.push({ text: `${/^[aeiou]/i.test(what) ? "an" : "a"} ${what}, ${where}, ${depth}`, d: dist });
    }
    return out.sort((a, b) => a.d - b.d).slice(0, 30).map((o) => o.text);
  }
  T.describeFurnitureInView = (camera) => { const w = T.__w3; return w ? furnitureInView(T.P, camera || w.camera, w.scene, w.furniture, w.THREE) : []; };

  T.Designer = {
    attach(o) {
      const { root, renderer, scene, camera, canvas, P, alive, roomAt, THREE, furniture } = o;
      const style = root.querySelector(".w3-style");
      if (!style) return;
      const before = style.querySelector(".w3-deco");
      const redesign = el("button", "w3-deco w3-redesign", "Redesign"); redesign.type = "button";
      redesign.setAttribute("aria-pressed", "false");
      redesign.title = "Interior designer: move and add furniture, repaint the walls";
      const reimagineBtn = el("button", "w3-deco w3-reimagine", "Reimagine"); reimagineBtn.type = "button";
      reimagineBtn.title = "A photographic version of your design in the real room";
      style.insertBefore(redesign, before);
      // the design tools are the walk's other decorating buttons (not Furnish from photos or the scan switch)
      const tools = () => [...style.querySelectorAll(".w3-deco")].filter((b) => !/w3-(redesign|reimagine|furnish|scans)/.test(b.className));
      tools().forEach((b) => (b.hidden = true));
      // Reimagine is always there, right under Redesign: it turns whatever the room looks like now
      // (your redesign, or the room as furnished) into a photographic picture
      const lastTool = tools().pop();
      style.insertBefore(reimagineBtn, lastTool ? lastTool.nextSibling : redesign.nextSibling);

      let on = false;
      const closePanels = () => root.querySelectorAll(".dc-panel:not([hidden]) .dc-done").forEach((b) => b.click());
      function setOn(v) {
        on = v;
        redesign.setAttribute("aria-pressed", String(v));
        redesign.textContent = v ? "Done redesigning" : "Redesign";
        tools().forEach((b) => (b.hidden = !v));
        root.classList.toggle("is-redesigning", v);
        if (!v) closePanels();
      }
      redesign.addEventListener("click", () => setOn(!on));
      // once something has been changed, draw the eye to it
      const nudge = () => reimagineBtn.classList.toggle("is-ready", changedOnce);
      nudge();
      T.on("tour:design-changed", nudge);

      // ---- the result panel ----
      const sheet = el("div", "rm-sheet"); sheet.hidden = true;
      sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-label", "Reimagined");
      sheet.innerHTML = `
        <div class="rm-box">
          <div class="rm-head"><h2 class="rm-title">Reimagined</h2><button type="button" class="rm-close">Back to designing</button></div>
          <div class="rm-grid">
            <figure class="rm-fig rm-photo"><img alt=""><figcaption>The room now (your photo)</figcaption></figure>
            <figure class="rm-fig rm-design"><img alt=""><figcaption>Your design in the 3D walk</figcaption></figure>
            <figure class="rm-fig rm-result"><div class="rm-wait"><span class="rm-spin" aria-hidden="true"></span><p class="rm-status" aria-live="polite"></p></div><img alt="" hidden><p class="rm-note" hidden></p><figcaption>Reimagined by Google Gemini: an AI impression, not a photo <span class="rm-made"></span></figcaption></figure>
          </div>
          <div class="rm-foot">
            <button type="button" class="rm-again">Reimagine again</button>
            <a class="rm-save" target="_blank" rel="noopener" hidden>Open full size</a>
          </div>
        </div>`;
      root.appendChild(sheet);
      const $ = (q) => sheet.querySelector(q);
      const closeSheet = () => { sheet.hidden = true; canvas.focus({ preventScroll: true }); };
      $(".rm-close").addEventListener("click", closeSheet);
      sheet.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); e.stopPropagation(); });
      sheet.addEventListener("click", (e) => { if (e.target === sheet) closeSheet(); });

      let last = null, busy = false;   // last = { render, photo, roomName }
      const send = async (req) => {
        if (T.isEmbed && T.embedRequest) return T.embedRequest("veduta:reimagine", req);
        const api = ((window.TOUR_CONFIG || {}).API_URL || "").replace(/\/+$/, "");
        if (!api) throw new Error("Reimagine needs the Veduta backend. Open this flat from Veduta, or set API_URL in config.js to the backend’s address.");
        const res = await fetch(api + "/reimagine", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req) });
        if (!res.ok) throw new Error(await res.text().catch(() => "") || `Request failed (${res.status})`);
        return res.json();
      };
      async function generate() {
        if (busy || !last) return;
        busy = true;
        $(".rm-again").disabled = true; $(".rm-save").hidden = true; $(".rm-note").hidden = true;
        $(".rm-result img").hidden = true; $(".rm-wait").hidden = false; $(".rm-spin").hidden = false;
        $(".rm-status").textContent = `Reimagining the ${last.roomName.toLowerCase()}. This usually takes 5 to 15 seconds…`;
        try {
          const res = await send(Object.assign({}, last, { notes: "" }));
          if (!res || !res.imageUrl) throw new Error("Google didn’t send an image back.");
          const img = $(".rm-result img");
          await new Promise((ok, bad) => { img.onload = ok; img.onerror = () => bad(new Error("The reimagined image couldn’t be loaded.")); img.src = res.imageUrl; });
          img.hidden = false; $(".rm-wait").hidden = true;
          // a note under the picture when it isn't really a reimagining
          const unchanged = !res.mock && (res.unchanged || await sameAsRender(last.render, res.imageUrl));
          const note = res.mock ? "This is Veduta’s mock backend, which can’t call Google, so this is your design as rendered. Connect the real backend with GEMINI_API_KEY set to reimagine it."
            : unchanged ? "Google sent back almost exactly your design. Press Reimagine again for another go." : "";
          $(".rm-made").textContent = res.model ? `Made with ${res.model}` : "";
          $(".rm-note").textContent = note; $(".rm-note").hidden = !note;
          const save = $(".rm-save"); save.href = res.imageUrl; save.hidden = false;
        } catch (e) {
          $(".rm-spin").hidden = true;
          $(".rm-status").textContent = plainError(e);
        } finally {
          busy = false; $(".rm-again").disabled = false;
        }
      }
      $(".rm-again").addEventListener("click", generate);

      // the room you're looking at (the middle of the view), which isn't always the one you're standing in:
      // from a hall, looking through a doorway into the living room, it's the living room
      const roomInView = () => {
        if (!THREE || !P.model) return null;
        const ray = new THREE.Raycaster();
        ray.setFromCamera(new THREE.Vector2(0, -0.15), camera);
        const hit = ray.intersectObjects(scene.children, true).find((h) => h.object.visible && h.distance > 0.3 && h.object.type !== "Sprite");
        if (!hit) return null;
        const s = P.model.metresPerPx;
        return T.roomAtPoint(P, hit.point.x / s, hit.point.z / s);
      };
      const firstPhoto = async (room) => {
        for (let i = 0; room && i < room.media.length; i++) {
          if (room.media[i].type !== "photo") continue;
          try { const r = await T.mediaImage(P, room, i); if (!r.placeholder) return toJpeg(r.image); } catch (e) { /* try the next */ }
        }
        return null;
      };

      reimagineBtn.addEventListener("click", async () => {
        if (busy) return;
        const room = roomInView() || roomAt();
        if (!room) { reimagineBtn.textContent = "Stand in a room first"; setTimeout(() => (reimagineBtn.textContent = "Reimagine"), 2200); return; }
        // tidy up first, so no selection outlines or panels end up in the picture
        closePanels();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        if (!alive()) return;
        renderer.render(scene, camera);           // draw and read back in the same task
        const render = toJpeg(renderer.domElement);
        // the room's own photo; failing that, one from elsewhere in the home, as a guide to its style
        let photo = await firstPhoto(room), photoIsThisRoom = true, photoRoom = room;
        if (!photo) for (const other of P.rooms) { if (other === room) continue; photo = await firstPhoto(other); if (photo) { photoIsThisRoom = false; photoRoom = other; break; } }
        // every piece you can see, its colour and where it is, so the model keeps them all, in place, in colour
        const pieces = furnitureInView(P, camera, scene, furniture && furniture(), THREE);
        last = { render, photo, roomName: room.name, photoIsThisRoom, furniture: pieces };
        $(".rm-title").textContent = `${room.name}, reimagined`;
        $(".rm-photo").hidden = !photo;
        $(".rm-photo figcaption").textContent = photoIsThisRoom ? "The room now (your photo)" : `Style guide: your photo of the ${photoRoom.name.toLowerCase()}`;
        $(".rm-grid").classList.toggle("no-photo", !photo);
        if (photo) $(".rm-photo img").src = photo;
        $(".rm-design img").src = render;
        sheet.hidden = false;
        $(".rm-close").focus();
        generate();
      });
    },
  };
})();
