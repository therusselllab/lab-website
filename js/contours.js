/* ============================================================
   Russell Lab — contours.js
   Draws the home-page contour map on a canvas so the lines can
   react to the cursor: lines near the pointer light up, and
   moving the pointer through them makes them wobble and settle.
   If anything fails, the CSS background image stays in place.
   ============================================================ */

(function () {
  'use strict';

  const hero = document.querySelector('.hero');
  if (!hero || !window.fetch || !window.Path2D) return;

  const SVG_URL = 'assets/images/contour_map_2_colors.svg';
  const VIEWBOX = 1000;
  const STEP = 3;              // spacing of sampled points along each line (viewBox units)
  const BASE_ALPHA = 0.25;     // matches the old 75% white overlay
  const GLOW_RADIUS = 240;     // px, size of the lit area around the cursor
  const PUSH_RADIUS = 70;      // viewBox units, how far the wobble reaches
  const SPRING = 0.07;
  const DAMPING = 0.86;
  const MAX_OFFSET = 22;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
    const lit = document.createElement('canvas');
    const litCtx = lit.getContext('2d');

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

    // Spatial grid so we only touch points near the cursor
    const CELL = 50, COLS = Math.ceil(VIEWBOX / CELL) + 1;
    const grid = Array.from({ length: COLS * COLS }, () => []);
    for (let k = 0; k < total; k++) {
      const c = Math.min(COLS - 1, Math.max(0, Math.floor(bx[k] / CELL)));
      const r = Math.min(COLS - 1, Math.max(0, Math.floor(by[k] / CELL)));
      grid[r * COLS + c].push(k);
    }

    const active = new Set();
    let W = 0, H = 0, dpr = 1, scale = 1, originX = 0;
    let mouse = null, glow = 0, running = false;

    function resize() {
      const rect = hero.getBoundingClientRect();
      W = rect.width; H = rect.height;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      [canvas, lit].forEach(c => { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); });
      // Same framing as the old CSS background (110% wide, 5% from the left, top-anchored),
      // but never shorter than the hero so tall phone screens are fully covered
      const imgW = Math.max(W * 1.1, H);
      scale = imgW / VIEWBOX;
      originX = 0.05 * (W - imgW);
      draw();
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

    function paint(c, alpha, lit) {
      c.setTransform(scale * dpr, 0, 0, scale * dpr, originX * dpr, 0);
      c.globalAlpha = alpha;
      shapes.forEach(sh => {
        if (sh.dirty) buildPath(sh);
        c.fillStyle = lit ? sh.litColour : sh.colour;
        c.fill(sh.path, 'evenodd');
      });
    }

    function draw() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      paint(ctx, BASE_ALPHA, false);

      if (mouse && glow > 0.01) {
        // Draw the full-strength lines, keep only a soft circle around the cursor
        litCtx.setTransform(1, 0, 0, 1, 0, 0);
        litCtx.globalCompositeOperation = 'source-over';
        litCtx.clearRect(0, 0, lit.width, lit.height);
        paint(litCtx, 1, true);
        litCtx.setTransform(1, 0, 0, 1, 0, 0);
        litCtx.globalAlpha = 1;
        litCtx.globalCompositeOperation = 'destination-in';
        const mx = mouse.x * dpr, my = mouse.y * dpr, r = GLOW_RADIUS * dpr;
        const g = litCtx.createRadialGradient(mx, my, 0, mx, my, r);
        g.addColorStop(0, `rgba(0,0,0,${0.95 * glow})`);
        g.addColorStop(0.5, `rgba(0,0,0,${0.5 * glow})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        litCtx.fillStyle = g;
        litCtx.fillRect(0, 0, lit.width, lit.height);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.drawImage(lit, 0, 0);
      }
    }

    function nudge(px, py, dx, dy) {
      // Cursor position and movement in viewBox units
      const x = (px - originX) / scale, y = py / scale;
      const mvx = dx / scale, mvy = dy / scale;
      const c0 = Math.floor((x - PUSH_RADIUS) / CELL), c1 = Math.floor((x + PUSH_RADIUS) / CELL);
      const r0 = Math.floor((y - PUSH_RADIUS) / CELL), r1 = Math.floor((y + PUSH_RADIUS) / CELL);
      for (let r = Math.max(0, r0); r <= Math.min(COLS - 1, r1); r++) {
        for (let c = Math.max(0, c0); c <= Math.min(COLS - 1, c1); c++) {
          for (const k of grid[r * COLS + c]) {
            const ex = bx[k] + ox[k] - x, ey = by[k] + oy[k] - y;
            const dist = Math.hypot(ex, ey);
            if (dist > PUSH_RADIUS) continue;
            const f = 1 - dist / PUSH_RADIUS, falloff = f * f;
            const away = Math.hypot(mvx, mvy) * 0.12 / (dist + 1);
            vx[k] += falloff * (mvx * 0.22 + ex * away);
            vy[k] += falloff * (mvy * 0.22 + ey * away);
            active.add(k);
          }
        }
      }
    }

    function step() {
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
    }

    function frame() {
      const target = mouse ? 1 : 0;
      glow += (target - glow) * 0.12;
      step();
      draw();
      if (active.size || Math.abs(target - glow) > 0.01) {
        requestAnimationFrame(frame);
      } else {
        glow = target;
        running = false;
        draw();
      }
    }

    function wake() {
      if (!running) { running = true; requestAnimationFrame(frame); }
    }

    hero.addEventListener('pointermove', e => {
      const rect = hero.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      if (mouse && !reduceMotion) nudge(x, y, x - mouse.x, y - mouse.y);
      mouse = { x, y };
      wake();
    });
    hero.addEventListener('pointerleave', () => { mouse = null; wake(); });
    window.addEventListener('resize', resize);

    hero.classList.add('hero--live');
    resize();
  }

  fetch(SVG_URL)
    .then(r => (r.ok ? r.text() : Promise.reject(r.status)))
    .then(text => init(parseSvg(text)))
    .catch(err => console.warn('Contour animation unavailable:', err));
})();
