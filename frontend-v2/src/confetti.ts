/**
 * A tiny, self-contained emoji-confetti burst — the reward flourish for the
 * bigger cheers (inbox zero, board's clear, a PR going green). Hand-rolled
 * rather than pulling in a particle library: one shared full-screen canvas
 * overlay, a pooled particle array, and a single rAF loop that stops itself
 * when everything's settled. Bursts compose — two rewards at once just add
 * particles to the same pool.
 *
 * Skips entirely under prefers-reduced-motion; the toast still says what
 * happened, it just doesn't throw paper.
 */

interface Particle {
   x: number;
   y: number;
   vx: number;
   vy: number;
   life: number;
   rot: number;
   vr: number;
   /** an emoji glyph, or null for a colored confetti rectangle */
   emoji: string | null;
   color: string;
   size: number;
}

// the app's brand blue leads, then a warm confetti spread
const COLORS = ['#0071CE', '#f2b544', '#2fb9a6', '#e35aa6', '#ff5c6a', '#7ee0a0'];
const GRAVITY = 0.22;

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let particles: Particle[] = [];
let running = false;

function prefersReducedMotion(): boolean {
   return (
      typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
   );
}

function ensureCanvas() {
   if (canvas) return;
   canvas = document.createElement('canvas');
   // above the board and the toast stack (z-50), below the modal scrim (z-100)
   canvas.style.cssText =
      'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:55';
   canvas.setAttribute('aria-hidden', 'true');
   document.body.appendChild(canvas);
   ctx = canvas.getContext('2d');
   sizeToWindow();
   window.addEventListener('resize', sizeToWindow);
}

function sizeToWindow() {
   if (!canvas || !ctx) return;
   const dpr = window.devicePixelRatio || 1;
   canvas.width = Math.floor(window.innerWidth * dpr);
   canvas.height = Math.floor(window.innerHeight * dpr);
   ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/** Throw a burst of the given emoji (mixed with colored confetti) up and out
 * from a page point — pass the medallion's center. No-op under reduced motion. */
export function burstEmoji(x: number, y: number, emojis: string[]) {
   if (prefersReducedMotion()) return;
   ensureCanvas();
   const count = 28;
   for (let i = 0; i < count; i++) {
      // fan upward: straight up ±~57°, with a little extra lift
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2;
      const speed = 5 + Math.random() * 7;
      const asEmoji = emojis.length > 0 && Math.random() < 0.5;
      particles.push({
         x,
         y,
         vx: Math.cos(angle) * speed,
         vy: Math.sin(angle) * speed - 2,
         life: 1,
         rot: Math.random() * Math.PI * 2,
         vr: (Math.random() - 0.5) * 0.35,
         emoji: asEmoji ? emojis[Math.floor(Math.random() * emojis.length)] : null,
         color: COLORS[Math.floor(Math.random() * COLORS.length)],
         size: asEmoji ? 16 + Math.random() * 8 : 6 + Math.random() * 4,
      });
   }
   if (!running) {
      running = true;
      requestAnimationFrame(tick);
   }
}

function tick() {
   if (!ctx || !canvas) {
      running = false;
      return;
   }
   const w = window.innerWidth;
   const h = window.innerHeight;
   ctx.clearRect(0, 0, w, h);
   for (const p of particles) {
      p.vy += GRAVITY;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      p.life -= 0.01;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      if (p.emoji) {
         ctx.font = `${p.size}px serif`;
         ctx.textAlign = 'center';
         ctx.textBaseline = 'middle';
         ctx.fillText(p.emoji, 0, 0);
      } else {
         ctx.fillStyle = p.color;
         ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      }
      ctx.restore();
   }
   // drop the dead and the fallen off the bottom
   particles = particles.filter(p => p.life > 0 && p.y < h + 40);
   if (particles.length) {
      requestAnimationFrame(tick);
   } else {
      ctx.clearRect(0, 0, w, h);
      running = false;
   }
}
