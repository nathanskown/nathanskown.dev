// Tiny helpers for drawing placeholder pixel art into canvas textures.

// Draw ASCII rows into a texture. Each character maps to a color in `palette`;
// '.' (or any unmapped char) is transparent. `scale` = screen pixels per art pixel.
export function asciiTexture(scene, key, rows, palette, scale = 2) {
  if (scene.textures.exists(key)) return;
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const tex = scene.textures.createCanvas(key, w * scale, h * scale);
  const ctx = tex.getContext();
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const col = palette[row[x]];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  });
  tex.refresh();
}

// Make a texture by drawing on a 2D canvas context.
export function canvasTexture(scene, key, w, h, draw) {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, w, h);
  draw(tex.getContext(), w, h);
  tex.refresh();
}

// Fill a rectangle on the art-pixel grid.
export function pix(ctx, x, y, w, h, color, s = 2) {
  ctx.fillStyle = color;
  ctx.fillRect(x * s, y * s, w * s, h * s);
}

// Deterministic random so tiles look the same every load.
export function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
