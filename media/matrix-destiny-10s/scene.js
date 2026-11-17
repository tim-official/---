"use strict";

(() => {
  const canvas = document.querySelector("canvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  const W = 1080;
  const H = 1920;
  const TAU = Math.PI * 2;
  const gold = [224, 181, 105];
  const clamp = (x) => Math.max(0, Math.min(1, x));
  const smooth = (x) => { const v = clamp(x); return v * v * (3 - 2 * v); };
  const reveal = (t, start, length = 1) => smooth((t - start) / length);
  const color = (alpha, rgb = gold) => `rgba(${rgb.join(",")},${clamp(alpha)})`;
  let seed = 220114;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const dust = Array.from({ length: 120 }, () => ({
    x: random() * W, y: random() * H, r: 0.5 + random() * 1.4,
    speed: 3 + random() * 15, phase: random() * TAU, alpha: 0.08 + random() * 0.36,
  }));
  const texture = document.createElement("canvas");
  texture.width = texture.height = 192;
  const grain = texture.getContext("2d");
  const image = grain.createImageData(192, 192);
  for (let i = 0; i < image.data.length; i += 4) {
    const light = random() > 0.5 ? 240 : 0;
    image.data.set([light, light, light, Math.floor(random() * 12)], i);
  }
  grain.putImageData(image, 0, 0);
  const grainPattern = ctx.createPattern(texture, "repeat");
  let textBounds = [];

  function radial(x, y, radius, opacity, rgb = gold) {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, color(opacity, rgb));
    gradient.addColorStop(0.22, color(opacity * 0.31, rgb));
    gradient.addColorStop(1, color(0, rgb));
    ctx.fillStyle = gradient;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  function path(points, opacity, width = 1.3, progress = 1) {
    const available = clamp(progress) * (points.length - 1);
    const whole = Math.floor(available);
    if (available <= 0) return;
    ctx.beginPath();
    ctx.moveTo(...points[0]);
    for (let i = 1; i <= whole; i++) ctx.lineTo(...points[i]);
    if (whole < points.length - 1) {
      const fraction = available - whole;
      ctx.lineTo(
        points[whole][0] + (points[whole + 1][0] - points[whole][0]) * fraction,
        points[whole][1] + (points[whole + 1][1] - points[whole][1]) * fraction,
      );
    }
    ctx.strokeStyle = color(opacity);
    ctx.lineWidth = width;
    ctx.stroke();
  }

  function ring(radius, opacity, width = 1, start = 0, end = TAU) {
    ctx.beginPath();
    ctx.arc(0, 0, radius, start, end);
    ctx.lineWidth = width;
    ctx.strokeStyle = color(opacity);
    ctx.stroke();
  }

  function type(text, y, size, opacity, spacing = 2, italic = false, important = true) {
    if (opacity <= 0) return;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.font = `${italic ? "italic " : ""}${size}px Georgia, "Times New Roman", serif`;
    ctx.textBaseline = "alphabetic";
    const widths = Array.from(text, (letter) => ctx.measureText(letter).width);
    const width = widths.reduce((sum, value) => sum + value, 0) + (widths.length - 1) * spacing;
    let x = (W - width) / 2;
    if (important) textBounds.push({ text, x, y: y - size, width, height: size * 1.22 });
    const fill = ctx.createLinearGradient(0, y - size, W * 0.6, y + 12);
    fill.addColorStop(0, "#d3ac6c");
    fill.addColorStop(0.31, "#fbebc7");
    fill.addColorStop(0.57, "#edc887");
    fill.addColorStop(1, "#c09a5e");
    ctx.fillStyle = fill;
    Array.from(text).forEach((letter, i) => {
      ctx.fillText(letter, x, y);
      x += widths[i] + spacing;
    });
    ctx.restore();
  }

  function smallType(text, y, opacity, size = 22, spacing = 5) {
    if (opacity <= 0) return;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.font = `${size}px "Segoe UI", sans-serif`;
    const letters = Array.from(text);
    const widths = letters.map((letter) => ctx.measureText(letter).width);
    let x = (W - widths.reduce((a, b) => a + b, 0) - spacing * (letters.length - 1)) / 2;
    ctx.fillStyle = "#a99777";
    letters.forEach((letter, i) => { ctx.fillText(letter, x, y); x += widths[i] + spacing; });
    ctx.restore();
  }

  function background(t) {
    ctx.fillStyle = "#060909";
    ctx.fillRect(0, 0, W, H);
    radial(540, 1040, 740, 0.14 + reveal(t, 0, 3) * 0.07, [143, 88, 37]);
    radial(700, 670, 570, 0.07, [128, 111, 78]);
    radial(380, 1710, 380, 0.047, [132, 87, 44]);
    const wash = ctx.createLinearGradient(0, 0, W, H);
    wash.addColorStop(0, "rgba(17,26,24,0.18)");
    wash.addColorStop(0.5, "rgba(0,0,0,0)");
    wash.addColorStop(1, "rgba(4,8,9,0.45)");
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, W, H);
    for (const particle of dust) {
      const y = ((particle.y - t * particle.speed) % H + H) % H;
      const x = particle.x + Math.sin(t * 0.18 + particle.phase) * 18;
      const alpha = particle.alpha * (0.6 + 0.4 * Math.sin(t * 0.5 + particle.phase)**2);
      ctx.fillStyle = color(alpha);
      ctx.beginPath();
      ctx.arc(x, y, particle.r, 0, TAU);
      ctx.fill();
      if (particle.r > 1.8) radial(x, y, 12, alpha * 0.2);
    }
  }

  function orbit(radius, tilt, rotation, opacity, t) {
    const vertices = [];
    for (let i = 0; i <= 180; i++) {
      const a = i / 180 * TAU + t * 0.035;
      const x = Math.cos(a) * radius;
      const y = Math.sin(a) * radius * Math.cos(tilt);
      const z = Math.sin(a) * radius * Math.sin(tilt);
      const perspective = 1400 / (1400 - z);
      vertices.push([
        (x * Math.cos(rotation) - y * Math.sin(rotation)) * perspective,
        (x * Math.sin(rotation) + y * Math.cos(rotation)) * perspective,
      ]);
    }
    path(vertices, opacity, 1.1);
  }

  function node(x, y, number, radius, alpha, light = 0) {
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.translate(x, y);
    if (light > 0) radial(0, 0, radius * 3.8, light * 0.16);
    const body = ctx.createRadialGradient(-radius * 0.35, -radius * 0.45, 2, 0, 0, radius);
    body.addColorStop(0, light > 0.3 ? "#584021" : "#25231b");
    body.addColorStop(0.7, "#141714");
    body.addColorStop(1, "#0a0e0d");
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, TAU);
    ctx.fill();
    ring(radius, 0.5 + light * 0.35, 1.9);
    ring(radius - 4.5, 0.17 + light * 0.1, 0.8);
    ring(radius, 0.65, 2.2, Math.PI * 1.05, Math.PI * 1.65);
    ctx.font = `${radius * 1.03}px Georgia, serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = light > 0.3 ? "#fff0c9" : "#dbc293";
    ctx.fillText(String(number), 0, 1);
    ctx.restore();
  }

  function matrix(t) {
    const opening = reveal(t, 0.05, 3.2);
    const scale = 1.21 - opening * 0.23 + reveal(t, 6, 4) * 0.025;
    const arrival = reveal(t, 0.4, 1.2);
    ctx.save();
    ctx.translate(540, 1010 + (1 - opening) * 100);
    ctx.scale(scale, scale);
    ctx.globalAlpha = 0.28 + arrival * 0.72;
    radial(0, 0, 540, 0.17);
    orbit(439, 0.67, -0.5 + t * 0.022, 0.2, t);
    orbit(466, 1.13, 1.02 - t * 0.038, 0.22, t);
    ctx.save();
    ctx.rotate(-0.075 + Math.sin(t * 0.2) * 0.024);
    ctx.scale(1, 0.9 + opening * 0.065);
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = 70;
    ctx.shadowOffsetY = 26;
    ctx.fillStyle = "#0a0d0b";
    ctx.beginPath();
    ctx.arc(0, 0, 396, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    const plate = ctx.createLinearGradient(-390, -400, 390, 430);
    plate.addColorStop(0, "#252419");
    plate.addColorStop(0.37, "#111710");
    plate.addColorStop(0.67, "#0b100d");
    plate.addColorStop(1, "#191b11");
    ctx.fillStyle = plate;
    ctx.fill();
    ring(396, 0.2, 8);
    ring(397, 0.74, 1.5);
    ring(386, 0.45, 1.2);
    ring(368, 0.24, 1.1);
    ring(350, 0.15, 0.8);
    ring(408, 0.18, 0.75);
    ctx.save();
    ctx.rotate(t * 0.017);
    for (let i = 0; i < 132; i++) {
      const a = i * TAU / 132;
      const major = i % 6 === 0;
      const radius = major ? 371 : 378;
      path([[Math.cos(a) * radius, Math.sin(a) * radius], [Math.cos(a) * 386, Math.sin(a) * 386]],
        major ? 0.54 : 0.22, major ? 1.5 : 0.8);
    }
    for (let i = 0; i < 22; i++) {
      const a = i * TAU / 22 - Math.PI / 2;
      ctx.save();
      ctx.translate(Math.cos(a) * 423, Math.sin(a) * 423);
      ctx.rotate(a + Math.PI / 2);
      ctx.font = '15px "Segoe UI", sans-serif';
      ctx.textAlign = "center";
      ctx.fillStyle = color(0.43);
      ctx.fillText(String(i + 1).padStart(2, "0"), 0, 0);
      ctx.restore();
    }
    ctx.restore();
    const vertices = Array.from({ length: 8 }, (_, i) => {
      const a = i * TAU / 8 - Math.PI / 2;
      return [Math.cos(a) * 304, Math.sin(a) * 304];
    });
    for (let i = 0; i < 8; i++) {
      const [x, y] = vertices[i];
      path([[0, 0], [x, y]], 0.32, 1.3, reveal(t, 0.8 + i * 0.08, 1.7));
      path([vertices[i], vertices[(i + 2) % 8]], 0.68, 1.65, reveal(t, 1.0 + i * 0.085, 1.5));
      path([vertices[i], vertices[(i + 1) % 8]], 0.28, 1.2, reveal(t, 1.2 + i * 0.06, 1.5));
    }
    ctx.setLineDash([2, 8]);
    ring(212, 0.24, 1);
    path([[-215, -215], [215, 215]], 0.26, 1, reveal(t, 2, 1.5));
    ctx.setLineDash([]);
    ring(112, 0.17, 1);
    const values = [11, 3, 17, 6, 8, 14, 5, 19];
    vertices.forEach(([x, y], i) => {
      const assembled = reveal(t, 0.72 + i * 0.1, 1.75);
      const spread = 1 + (1 - assembled) * 0.58;
      const light = Math.exp(-(((t - 3.35 - i * 0.19) / 0.55)**2)) * 0.85;
      node(x * spread, y * spread, values[i], i % 2 ? 27 : 32, assembled, light);
    });
    const inner = [[0, -154, 9], [154, 0, 7], [0, 154, 4], [-154, 0, 12], [108, 108, 21], [-108, -108, 18]];
    inner.forEach(([x, y, number], i) => node(x, y, number, 21, reveal(t, 1.85 + i * 0.075, 1.1), 0.06));
    const glow = reveal(t, 2.6, 1.4) * (0.75 + Math.sin(t * 0.8) * 0.09);
    radial(0, 0, 192, glow * 0.13);
    node(0, 0, 22, 60, reveal(t, 0.5, 1.8), glow);
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const angle = -2.6 + t * 0.14;
    radial(Math.cos(angle) * 397, Math.sin(angle) * 397, 112, 0.36);
    ring(397, 0.75, 2, angle - 0.18, angle + 0.26);
    radial(Math.cos(angle + Math.PI) * 390, Math.sin(angle + Math.PI) * 390, 60, 0.13);
    ctx.restore();
    ctx.restore();
    ctx.restore();
  }

  function headings(t) {
    const title = reveal(t, 0.16, 1.3);
    const lift = (1 - title) * 24;
    ctx.save();
    ctx.translate(540, 195);
    ctx.rotate(Math.PI / 4);
    ctx.strokeStyle = color(title * 0.62);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-11, -11, 22, 22);
    ctx.strokeStyle = color(title * 0.25);
    ctx.strokeRect(-18, -18, 36, 36);
    ctx.restore();
    smallType("ЧИСЛА. СМЫСЛЫ. ТЫ.", 253 + lift, title * 0.76, 22, 5);
    type("МАТРИЦА", 385 + lift, 104, title, 5.5);
    type("СУДЬБЫ", 503 + lift, 114, reveal(t, 0.36, 1.3), 8);
    ctx.save();
    const line = reveal(t, 0.8, 1.5);
    const span = 146 * line;
    path([[540 - span, 557], [540 + span, 557]], 0.3, 1);
    radial(540 + span, 557, 14, line * 0.15);
    ctx.restore();
    const transition = reveal(t, 5.55, 0.65);
    const date = reveal(t, 2.85, 0.72) * (1 - transition);
    const route = reveal(t, 4.15, 0.72) * (1 - transition);
    type("Твоя дата.", 1532 + (1 - reveal(t, 2.85, 0.72)) * 20, 63, date, 1, true);
    type("Твой путь.", 1610 + (1 - reveal(t, 4.15, 0.72)) * 20, 63, route, 1, true);
    const final = reveal(t, 6.0, 0.95);
    type("Открой себя", 1522 + (1 - final) * 22, 66, final, 0.5, true);
    type("с новой стороны.", 1605 + (1 - final) * 22, 62, final, 0.5, true);
    const footer = reveal(t, 7.05, 1);
    smallType("ТВОЯ ДАТА. ТВОЙ ПУТЬ.", 1730, footer * 0.8, 23, 3);
    path([[497, 1790], [533, 1790]], footer * 0.36, 1);
    path([[547, 1790], [583, 1790]], footer * 0.36, 1);
    ctx.save();
    ctx.translate(540, 1790);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = color(footer * 0.65);
    ctx.fillRect(-2.5, -2.5, 5, 5);
    ctx.restore();
  }

  function renderFrame(frame) {
    if (!Number.isInteger(frame) || frame < 0 || frame >= 600) throw new RangeError("Frame must be an integer from 0 to 599");
    const t = frame / 60;
    textBounds = [];
    ctx.resetTransform();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    background(t);
    matrix(t);
    headings(t);
    ctx.fillStyle = grainPattern;
    ctx.fillRect(0, 0, W, H);
    return { frame, width: W, height: H, seconds: 10, fps: 60, textBounds };
  }
  window.renderFrame = renderFrame;
  const rendering = new URLSearchParams(location.search).has("render");
  document.body.classList.toggle("render", rendering);
  if (rendering) {
    renderFrame(0);
    return;
  }
  const button = document.querySelector("button");
  let paused = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let elapsed = paused ? 9 : 0;
  let last = performance.now();
  button.textContent = paused ? "Смотреть анимацию" : "Пауза";
  button.setAttribute("aria-pressed", String(paused));
  button.addEventListener("click", () => {
    paused = !paused;
    button.textContent = paused ? "Продолжить" : "Пауза";
    button.setAttribute("aria-pressed", String(paused));
  });
  function tick(now) {
    if (!paused) elapsed = (elapsed + (now - last) / 1000) % 10;
    last = now;
    renderFrame(Math.floor(elapsed * 60));
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
