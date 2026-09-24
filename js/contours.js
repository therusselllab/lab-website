/* ============================================================
   Russell Lab — contours.js
   Draws the home-page contour map on a canvas so the lines can
   react to the cursor. Two effects are available (set MODE):
     'pulse'  – rings spread out from the cursor like an exposure,
                pushing the lines outward and lighting them up
     'wobble' – lines near the cursor light up and wobble like
                springs as the cursor moves through them
   If anything fails, the CSS background image stays in place.
   ============================================================ */

(function () {
  'use strict';

  const MODE = 'pulse';        // 'pulse' or 'wobble'

  const hero = document.querySelector('.hero');
  if (!hero || !window.fetch || !window.Path2D) return;

  const SVG_URL = 'assets/images/contour_map_2_colors.svg';
  const VIEWBOX = 1000;
  const STEP = 3;              // spacing of sampled points along each line (viewBox units)
  const BASE_ALPHA = 0.25;     // matches the old 75% white overlay
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Wobble settings
  const GLOW_RADIUS = 240;     // px, size of the lit area around the cursor
  const PUSH_RADIUS = 70;      // viewBox units, how far the wobble reaches
  const SPRING = 0.07;
  const DAMPING = 0.86;
  const MAX_OFFSET = 22;

  // Pulse settings (distances in viewBox units, times in ms)
  const PULSE_EVERY = 1500;    // a new ring from the cursor this often
  const PULSE_SPEED = 0.26;    // ring growth per ms
  const PULSE_LIFE = 2400;
  const PULSE_WIDTH = 24;      // thickness of the ring front
  const PULSE_PUSH = 7;        // how far lines are pushed as the front passes
  const SOURCE_GLOW = 110;     // px, soft glow around the cursor

  /* ---- SVG path parsing: flatten each subpath into points ---- */
  function flatten(d) {
    const tokens = d.match(/[a-zA-Z]|-?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/g) || [];
    const subpaths = [];
    let pts = null, i = 0, cmd = '';
    let x = 0, y = 0, sx = 0, sy = 0, lcx = 0, lcy = 0, prev = '';
    const num = () => parseFloat(tokens[i++]);
    const start = (nx, ny) => {
      if (pts && pts.length > 2) subpaths.push(pts);
      pts = [nx, ny]; x = sx = nx; y = sy = ny;
    };
    const lineTo = (nx, ny) => {
      const n = Math.max(1, Math.ceil(Math.hypot(nx - x, ny - y) / STEP));
      for (let k = 1; k <= n; k++) pts.push(x + (nx - x) * k / n, y + (ny - y) * k / n);
      x = nx; y = ny;
    };
    const cubicTo = (c1x, c1y, c2x, c2y, nx, ny) => {
      const len = Math.hypot(c1x - x, c1y - y) + Math.hypot(c2x - c1x, c2y - c1y) + Math.hypot(nx - c2x, ny - c2y);
      const n = Math.max(2, Math.ceil(len / STEP));
      for (let k = 1; k <= n; k++) {
        const t = k / n, u = 1 - t;
        pts.push(
          u * u * u * x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * nx,
          u * u * u * y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * ny
        );
      }
      lcx = c2x; lcy = c2y; x = nx; y = ny;
    };

    while (i < tokens.length) {
      if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
      const rel = cmd === cmd.toLowerCase();
      const ox = rel ? x : 0, oy = rel ? y : 0;
      switch (cmd.toUpperCase()) {
        case 'M': start(ox + num(), oy + num()); cmd = rel ? 'l' : 'L'; break;
        case 'L': lineTo(ox + num(), oy + num()); break;
        case 'H': lineTo((rel ? x : 0) + num(), y); break;
        case 'V': lineTo(x, (rel ? y : 0) + num()); break;
        case 'C': cubicTo(ox + num(), oy + num(), ox + num(), oy + num(), ox + num(), oy + num()); break;
        case 'S': {
          const smooth = /[CcSs]/.test(prev);
          const c1x = smooth ? 2 * x - lcx : x, c1y = smooth ? 2 * y - lcy : y;
          cubicTo(c1x, c1y, ox + num(), oy + num(), ox + num(), oy + num());
          break;
        }
        case 'Z': lineTo(sx, sy); break;
        default: i++; // unsupported command: skip a token rather than loop forever
      }
      prev = cmd;
    }
    if (pts && pts.length > 2) subpaths.push(pts);
    return subpaths;
  }

  function parseSvg(text) {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const colours = {};
    const css = doc.querySelector('style')?.textContent || '';
    css.replace(/\.(cls-\d+)\s*\{\s*fill:\s*(#[0-9a-f]+)/gi, (_, c, f) => { colours[c] = f; });
    return [...doc.querySelectorAll('path')].map(p => ({
      colour: colours[p.getAttribute('class')] || p.getAttribute('fill') || '#c9c9c9',
      subpaths: flatten(p.getAttribute('d') || ''),
    }));
  }

  /* ---- Build the scene ---- */
  function init(paths) {
    const canvas = document.createElement('canvas');
    canvas.className = 'hero__canvas';
    canvas.setAttribute('aria-hidden', 'true');
    // Inline too, so a stale cached stylesheet can't let it push the hero text aside
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
    hero.prepend(canvas);
    const ctx = canvas.getContext('2d');
    const lit = document.createElement('canvas');   // full-strength lines
    const litCtx = lit.getContext('2d');
    const mask = document.createElement('canvas');  // where the lit lines show through
    const maskCtx = mask.getContext('2d');

    // Flat typed arrays for every sampled point
    let total = 0;
    paths.forEach(p => p.subpaths.forEach(s => { total += s.length / 2; }));
    const bx = new Float32Array(total), by = new Float32Array(total);
    const ox = new Float32Array(total), oy = new Float32Array(total);
    const vx = new Float32Array(total), vy = new Float32Array(total);
    const owner = new Uint16Array(total);

    // Each shape keeps [start, end) index ranges into the arrays, one per subpath
    let n = 0;
    const shapes = paths.map((p, pi) => ({
      colour: p.colour,
      litColour: p.colour.toLowerCase() === '#c9c9c9' ? '#6f8fb3' : p.colour,
      ranges: p.subpaths.map(s => {
        const from = n;
        for (let k = 0; k < s.length; k += 2) {
          bx[n] = s[k]; by[n] = s[k + 1]; owner[n] = pi;
          n++;
        }
        return [from, n];
      }),
      path: null,
      dirty: true,
    }));

    // Spatial grid so we only touch points near the cursor / ring
    const CELL = 50, COLS = Math.ceil(VIEWBOX / CELL) + 1;
    const grid = Array.from({ length: COLS * COLS }, () => []);
    for (let k = 0; k < total; k++) {
      const c = Math.min(COLS - 1, Math.max(0, Math.floor(bx[k] / CELL)));
      const r = Math.min(COLS - 1, Math.max(0, Math.floor(by[k] / CELL)));
      grid[r * COLS + c].push(k);
    }
    function eachPointNear(x, y, radius, fn) {
      const c0 = Math.max(0, Math.floor((x - radius) / CELL)), c1 = Math.min(COLS - 1, Math.floor((x + radius) / CELL));
      const r0 = Math.max(0, Math.floor((y - radius) / CELL)), r1 = Math.min(COLS - 1, Math.floor((y + radius) / CELL));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) for (const k of grid[r * COLS + c]) fn(k);
    }

    let W = 0, H = 0, dpr = 1, scale = 1, originX = 0;
    let mouse = null, glow = 0, running = false;
    const toView = (px, py) => ({ x: (px - originX) / scale, y: py / scale });

    function resize() {
      const rect = hero.getBoundingClientRect();
      W = rect.width; H = rect.height;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      [canvas, lit, mask].forEach(c => { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); });
      // Same framing as the old CSS background (110% wide, 5% from the left, top-anchored),
      // but never shorter than the hero so tall phone screens are fully covered
      const imgW = Math.max(W * 1.1, H);
      scale = imgW / VIEWBOX;
      originX = 0.05 * (W - imgW);
      draw(performance.now());
    }

    function buildPath(sh) {
      const p = new Path2D();
      sh.ranges.forEach(([a, b]) => {
        p.moveTo(bx[a] + ox[a], by[a] + oy[a]);
        for (let k = a + 1; k < b; k++) p.lineTo(bx[k] + ox[k], by[k] + oy[k]);
        p.closePath();
      });
      sh.path = p; sh.dirty = false;
    }

    function paint(c, alpha, isLit) {
      c.setTransform(scale * dpr, 0, 0, scale * dpr, originX * dpr, 0);
      c.globalAlpha = alpha;
      shapes.forEach(sh => {
        if (sh.dirty) buildPath(sh);
        c.fillStyle = isLit ? sh.litColour : sh.colour;
        c.fill(sh.path, 'evenodd');
      });
    }

    // Soft circle or ring of "light" on the mask canvas (screen px)
    function glowSpot(x, y, inner, peak, outer, alpha) {
      if (alpha <= 0.01 || outer <= 0) return;
      const g = maskCtx.createRadialGradient(x * dpr, y * dpr, 0, x * dpr, y * dpr, outer * dpr);
      const a = Math.max(0, Math.min(1, inner / outer)), b = Math.max(a, Math.min(1, peak / outer));
      g.addColorStop(0, `rgba(0,0,0,${inner > 0 ? 0 : alpha})`);
      if (a > 0) g.addColorStop(a, 'rgba(0,0,0,0)');
      g.addColorStop(b, `rgba(0,0,0,${alpha})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      maskCtx.fillStyle = g;
      maskCtx.fillRect((x - outer) * dpr, (y - outer) * dpr, outer * 2 * dpr, outer * 2 * dpr);
    }

    function draw(now) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      paint(ctx, BASE_ALPHA, false);

      maskCtx.setTransform(1, 0, 0, 1, 0, 0);
      maskCtx.globalCompositeOperation = 'source-over';
      maskCtx.clearRect(0, 0, mask.width, mask.height);
      maskCtx.globalCompositeOperation = 'lighter';
      let anyLight = false;
      if (MODE === 'wobble') {
        if (mouse && glow > 0.01) {
          glowSpot(mouse.x, mouse.y, 0, GLOW_RADIUS * 0.5, GLOW_RADIUS, 0.95 * glow);
          anyLight = true;
        }
      } else {
        if (mouse && glow > 0.01) { glowSpot(mouse.x, mouse.y, 0, 0, SOURCE_GLOW, 0.8 * glow); anyLight = true; }
        pulses.forEach(p => {
          const age = now - p.t0, fade = 1 - age / PULSE_LIFE;
          if (fade <= 0) return;
          const r = age * PULSE_SPEED * scale, w = PULSE_WIDTH * 2.2 * scale;
          const sx = p.x * scale + originX, sy = p.y * scale;
          glowSpot(sx, sy, Math.max(0, r - w), r, r + w, 0.9 * fade * p.strength);
          anyLight = true;
        });
      }
      if (!anyLight) return;

      // Full-strength lines, kept only where the mask is lit
      litCtx.setTransform(1, 0, 0, 1, 0, 0);
      litCtx.globalCompositeOperation = 'source-over';
      litCtx.clearRect(0, 0, lit.width, lit.height);
      paint(litCtx, 1, true);
      litCtx.setTransform(1, 0, 0, 1, 0, 0);
      litCtx.globalAlpha = 1;
      litCtx.globalCompositeOperation = 'destination-in';
      litCtx.drawImage(mask, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.drawImage(lit, 0, 0);
    }

    /* -- Wobble: pointer movement kicks nearby points, springs pull them back -- */
    const active = new Set();
    function nudge(px, py, dx, dy) {
      const { x, y } = toView(px, py);
      const mvx = dx / scale, mvy = dy / scale;
      eachPointNear(x, y, PUSH_RADIUS, k => {
        const ex = bx[k] + ox[k] - x, ey = by[k] + oy[k] - y;
        const dist = Math.hypot(ex, ey);
        if (dist > PUSH_RADIUS) return;
        const f = 1 - dist / PUSH_RADIUS, falloff = f * f;
        const away = Math.hypot(mvx, mvy) * 0.12 / (dist + 1);
        vx[k] += falloff * (mvx * 0.22 + ex * away);
        vy[k] += falloff * (mvy * 0.22 + ey * away);
        active.add(k);
      });
    }
    function stepWobble() {
      for (const k of active) {
        vx[k] = (vx[k] - ox[k] * SPRING) * DAMPING;
        vy[k] = (vy[k] - oy[k] * SPRING) * DAMPING;
        ox[k] = Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, ox[k] + vx[k]));
        oy[k] = Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, oy[k] + vy[k]));
        shapes[owner[k]].dirty = true;
        if (Math.abs(ox[k]) + Math.abs(oy[k]) + Math.abs(vx[k]) + Math.abs(vy[k]) < 0.02) {
          ox[k] = oy[k] = vx[k] = vy[k] = 0;
          active.delete(k);
        }
      }
      return active.size > 0;
    }

    /* -- Pulse: expanding rings push points outward as the front passes -- */
    const pulses = [];
    let touched = [];
    let lastPulse = -Infinity;
    function emit(px, py, now, strength) {
      pulses.push({ ...toView(px, py), t0: now, strength });
      lastPulse = now;
      wake();
    }
    function stepPulse(now) {
      while (pulses.length && now - pulses[0].t0 > PULSE_LIFE) pulses.shift();
      if (mouse && now - lastPulse > PULSE_EVERY) emit(mouse.x, mouse.y, now, 1);
      if (reduceMotion) return pulses.length > 0;

      touched.forEach(k => { ox[k] = oy[k] = 0; shapes[owner[k]].dirty = true; });
      const next = [];
      pulses.forEach(p => {
        const age = now - p.t0, r = age * PULSE_SPEED;
        const amp = PULSE_PUSH * p.strength * Math.pow(1 - age / PULSE_LIFE, 1.5);
        if (amp < 0.05) return;
        const reach = r + PULSE_WIDTH * 3;
        eachPointNear(p.x, p.y, reach, k => {
          const ex = bx[k] - p.x, ey = by[k] - p.y;
          const d = Math.hypot(ex, ey);
          const u = (d - r) / PULSE_WIDTH;
          if (u < -3 || u > 3 || d < 0.001) return;
          const push = amp * Math.exp(-u * u) / d;
          ox[k] += ex * push; oy[k] += ey * push;
          shapes[owner[k]].dirty = true;
          next.push(k);
        });
      });
      touched = next;
      return pulses.length > 0 || touched.length > 0;
    }

    function frame(now) {
      const target = mouse ? 1 : 0;
      glow += (target - glow) * 0.12;
      const busy = MODE === 'wobble' ? stepWobble() : stepPulse(now);
      draw(now);
      if (busy || mouse || Math.abs(target - glow) > 0.01) {
        requestAnimationFrame(frame);
      } else {
        glow = target;
        running = false;
        draw(now);
      }
    }

    function wake() {
      if (!running) { running = true; requestAnimationFrame(frame); }
    }

    hero.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch') return;   // on touch screens, taps make pulses instead
      const rect = hero.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      if (MODE === 'wobble' && mouse && !reduceMotion) nudge(x, y, x - mouse.x, y - mouse.y);
      mouse = { x, y };
      wake();
    });
    hero.addEventListener('pointerleave', () => { mouse = null; wake(); });
    hero.addEventListener('pointerdown', e => {
      if (MODE !== 'pulse') return;
      const rect = hero.getBoundingClientRect();
      emit(e.clientX - rect.left, e.clientY - rect.top, performance.now(), 1.6);
    });
    window.addEventListener('resize', resize);

    hero.classList.add('hero--live');
    resize();

    // One gentle ring on load, from the right-hand side, to hint that the lines respond
    if (MODE === 'pulse' && !reduceMotion) {
      setTimeout(() => emit(W * 0.72, Math.min(H * 0.55, 520), performance.now(), 0.8), 900);
    }
  }

  fetch(SVG_URL)
    .then(r => (r.ok ? r.text() : Promise.reject(r.status)))
    .then(text => init(parseSvg(text)))
    .catch(err => console.warn('Contour animation unavailable:', err));
})();
