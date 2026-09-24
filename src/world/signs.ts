import { rng } from './geom';
import type { SignAtlas } from './kit';

type UV = [number, number, number, number];
const KN = '"Noto Sans Kannada", "Kannada Sangam MN", "Tunga", "Nirmala UI", sans-serif';
const SANS = '"Helvetica Neue", "Segoe UI", Arial, sans-serif';

/** PES emblem: orange-red disc, white 8-point compass star, navy ring, small globe centre. */
export function drawPesLogo(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, ring = '#1f2b45'): void {
  g.save();
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fillStyle = ring; g.fill();
  g.beginPath(); g.arc(cx, cy, r * 0.86, 0, Math.PI * 2); g.fillStyle = '#e8622a'; g.fill();
  g.fillStyle = '#fff7ee';
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2, len = i % 2 ? r * 0.5 : r * 0.78, w = r * (i % 2 ? 0.1 : 0.14);
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
    g.lineTo(cx + Math.cos(a + Math.PI / 2) * w, cy + Math.sin(a + Math.PI / 2) * w);
    g.lineTo(cx - Math.cos(a) * r * 0.1, cy - Math.sin(a) * r * 0.1);
    g.lineTo(cx + Math.cos(a - Math.PI / 2) * w, cy + Math.sin(a - Math.PI / 2) * w);
    g.closePath(); g.fill();
  }
  g.beginPath(); g.arc(cx, cy, r * 0.2, 0, Math.PI * 2); g.fillStyle = '#2d59a8'; g.fill();
  g.restore();
}

function fitText(g: CanvasRenderingContext2D, text: string, maxW: number, size: number, weight: string, family: string): number {
  g.font = `${weight} ${size}px ${family}`;
  while (g.measureText(text).width > maxW && size > 8) { size -= 2; g.font = `${weight} ${size}px ${family}`; }
  return size;
}

export interface SignUVs {
  gateBeamEast: UV; gateBeamWest: UV; gatePillarText: UV; gateBanner: UV;
  pesBridge: UV; bblockCrest: UV; mrdCanopy: UV; pesSociety: UV; porteBanner: UV;
  quadBanner: UV[]; lawSign: UV; fBlockRoof: UV; muralOuter: UV; muralInner: UV; guardBooth: UV;
  building: Map<string, UV>;
}

/** Draw every sign / mural into the atlas. */
export function drawSigns(atlas: SignAtlas, buildingSigns: { id: string; text: string; sub?: string; color: string }[]): SignUVs {
  const A = atlas;

  // --- gate beam, east (outside) face: logo + Kannada at the south (left) end, "PESU" at the north end ---
  const beamW = 1280, beamH = 128;
  const gateBeamEast = A.add(beamW, beamH, (g, w, h) => {
    g.fillStyle = '#f5f4f0'; g.fillRect(0, 0, w, h);
    drawPesLogo(g, 110, h / 2, 36);
    g.fillStyle = '#5a1522'; g.textBaseline = 'middle'; g.textAlign = 'left';
    fitText(g, 'ಪಿಇಎಸ್ ವಿಶ್ವವಿದ್ಯಾಲಯ', 520, 60, '700', KN);
    g.fillText('ಪಿಇಎಸ್ ವಿಶ್ವವಿದ್ಯಾಲಯ', 160, h / 2 + 2);
    drawPesLogo(g, w - 150, h / 2, 16);
    g.fillStyle = '#1f2b45'; g.font = `800 34px ${SANS}`; g.fillText('PESU', w - 128, h / 2 + 2);
  });
  const gateBeamWest = A.add(beamW, beamH, (g, w, h) => {
    g.fillStyle = '#f5f4f0'; g.fillRect(0, 0, w, h);
    drawPesLogo(g, w - 240, h / 2, 20);
    g.fillStyle = '#8c1d2c'; g.font = `800 40px ${SANS}`; g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillText('PESU', w - 212, h / 2 + 2);
  });
  // vertical maroon "PES UNIVERSITY" (drawn horizontally; rotated on the quad)
  const gatePillarText = A.add(1024, 128, (g, w, h) => {
    g.fillStyle = '#8c1d2c'; g.textAlign = 'center'; g.textBaseline = 'middle';
    fitText(g, 'PES UNIVERSITY', w * 0.96, 104, '800', SANS);
    g.fillText('PES UNIVERSITY', w / 2, h / 2 + 4);
  });
  const gateBanner = A.add(256, 320, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#8c1d2c'; g.fillRect(0, 0, 18, h); g.fillRect(0, 0, w, 16);
    drawPesLogo(g, w - 34, 44, 20);
    g.fillStyle = '#1f2b45'; g.textAlign = 'center';
    g.font = `700 15px ${SANS}`; g.fillText('1st INTERNATIONAL', w / 2, 58); g.fillText('STAFF TOURNAMENT', w / 2, 78);
    g.fillStyle = '#b3261e'; g.font = `800 20px ${SANS}`;
    ['CRICKET', 'BADMINTON', 'VOLLEYBALL', 'THROWBALL', 'TABLE TENNIS', 'SQUASH'].forEach((s, i) => g.fillText(s, w / 2, 118 + i * 28));
    g.fillStyle = '#1f2b45'; g.font = `700 14px ${SANS}`; g.fillText('ALL ARE CORDIALLY INVITED', w / 2, h - 16);
  });
  // PES signboard skybridge (east face)
  const pesBridge = A.add(1024, 200, (g, w, h) => {
    g.fillStyle = '#fbfbf8'; g.fillRect(0, 0, w, h);
    drawPesLogo(g, w * 0.36, h / 2, 64);
    g.fillStyle = '#1f2b45'; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.font = `800 104px ${SANS}`; g.fillText('PES', w * 0.36 + 84, h / 2 - 12);
    g.font = `600 30px ${SANS}`; g.fillText('UNIVERSITY', w * 0.36 + 90, h / 2 + 52);
  });
  // B-Block crest-tower roof sign
  const bblockCrest = A.add(512, 170, (g, w, h) => {
    g.fillStyle = '#fbfbf8'; g.fillRect(0, 0, w, h);
    drawPesLogo(g, 90, h / 2, 52);
    g.fillStyle = '#c8261e'; g.textAlign = 'left'; g.textBaseline = 'middle';
    fitText(g, 'ಪಿಇಎಸ್', 330, 96, '800', KN);
    g.fillText('ಪಿಇಎಸ್', 160, h / 2 + 4);
  });
  // MRD navy canopy fascia
  const mrdCanopy = A.add(1536, 72, (g, w, h) => {
    g.fillStyle = '#1f2b45'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#c9ced6'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `600 22px ${KN}`; g.fillText('ಡಾ. ಎಂ.ಆರ್. ದೊರೆಸ್ವಾಮಿ', w * 0.12, h / 2);
    fitText(g, 'DR. M.R. DORESWAMY   SILVER JUBILEE COMPLEX', w * 0.62, 40, '700', SANS);
    g.fillText('DR. M.R. DORESWAMY   SILVER JUBILEE COMPLEX', w * 0.55, h / 2 + 2);
    g.font = `600 22px ${KN}`; g.fillText('ರಜತ ಮಹೋತ್ಸವ ಸಂಕೀರ್ಣ', w * 0.92, h / 2);
  });
  // covered plaza: PEOPLES EDUCATION SOCIETY (red letters on white fascia)
  const pesSociety = A.add(1024, 96, (g, w, h) => {
    g.fillStyle = '#f6f5f1'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#b3261e'; g.textAlign = 'center'; g.textBaseline = 'middle';
    fitText(g, 'PEOPLES EDUCATION SOCIETY', w * 0.92, 64, '700', SANS);
    g.fillText('PEOPLES EDUCATION SOCIETY', w / 2, h / 2 + 3);
  });
  // porte-cochère banner: orange | white with PES University
  const porteBanner = A.add(512, 128, (g, w, h) => {
    g.fillStyle = '#f08a24'; g.fillRect(0, 0, w * 0.38, h);
    g.fillStyle = '#f7f6f2'; g.fillRect(w * 0.38, 0, w * 0.62, h);
    g.fillStyle = '#ffffff'; g.font = `800 52px ${SANS}`; g.textBaseline = 'middle'; g.textAlign = 'right'; g.fillText('GS!', w * 0.36, h / 2);
    drawPesLogo(g, w * 0.52, h / 2, 34);
    g.fillStyle = '#1f2b45'; g.textAlign = 'left'; g.font = `800 44px ${SANS}`; g.fillText('PES', w * 0.6, h / 2 - 10);
    g.font = `600 18px ${SANS}`; g.fillText('UNIVERSITY', w * 0.6, h / 2 + 24);
  });
  // Quad column banners (blue, white graphics) – three variants
  const quadBanner: UV[] = [];
  for (let v = 0; v < 3; v++) {
    quadBanner.push(A.add(96, 320, (g, w, h) => {
      const r = rng(40 + v);
      g.fillStyle = '#2d59a8'; g.fillRect(0, 0, w, h);
      drawPesLogo(g, w / 2, 40, 16, '#ffffff');
      g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.font = `700 11px ${SANS}`;
      g.fillText(['BHARAT', 'PESU', 'CONVOCATION'][v], w / 2, 78);
      g.fillText(['INNOVATION', 'AT 50', '2026'][v], w / 2, 92);
      g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 2;
      for (let k = 0; k < 7; k++) { g.beginPath(); const y = 200 + k * 14; g.moveTo(0, y); for (let x = 0; x <= w; x += 8) g.lineTo(x, y + Math.sin(x * 0.12 + k + r() * 0.5) * 6); g.stroke(); }
    }));
  }
  const lawSign = A.add(256, 72, (g, w, h) => {
    g.fillStyle = '#1f2b45'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#f0f0ea'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `700 24px ${SANS}`; g.fillText('Faculty of Law', w / 2, 24);
    g.font = `600 18px ${KN}`; g.fillText('ಕಾನೂನು ವಿಭಾಗ', w / 2, 52);
  });
  const fBlockRoof = A.add(256, 96, (g, w, h) => {
    g.fillStyle = '#fbfbf8'; g.fillRect(0, 0, w, h);
    drawPesLogo(g, 52, h / 2, 34);
    g.fillStyle = '#1f2b45'; g.font = `800 60px ${SANS}`; g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillText('PES', 96, h / 2 + 2);
  });
  const guardBooth = A.add(128, 48, (g, w, h) => {
    g.fillStyle = '#2d59a8'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.font = `700 20px ${SANS}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('SECURITY', w / 2, h / 2);
  });

  // --- outer mural (gate, outside): warm "Community Development" relief mural ---
  const muralOuter = A.add(1024, 512, (g, W, H) => {
    const r = rng(2024);
    const grd = g.createLinearGradient(0, 0, W, H);
    grd.addColorStop(0, '#e2b24a'); grd.addColorStop(0.4, '#f0c867'); grd.addColorStop(0.7, '#5e9f6a'); grd.addColorStop(1, '#2e8c8c');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    // sweeping bands
    for (let i = 0; i < 6; i++) {
      g.fillStyle = ['rgba(200,69,46,0.35)', 'rgba(94,143,58,0.45)', 'rgba(46,140,140,0.4)', 'rgba(226,178,74,0.5)'][i % 4];
      g.beginPath(); g.moveTo(0, H * (0.2 + i * 0.13));
      g.bezierCurveTo(W * 0.3, H * (0.05 + i * 0.12), W * 0.6, H * (0.45 + i * 0.08), W, H * (0.25 + i * 0.1));
      g.lineTo(W, H * (0.32 + i * 0.1)); g.bezierCurveTo(W * 0.6, H * (0.52 + i * 0.08), W * 0.3, H * (0.12 + i * 0.12), 0, H * (0.27 + i * 0.13));
      g.fill();
    }
    // tree
    g.strokeStyle = '#6a3f22'; g.lineCap = 'round';
    const branch = (x: number, y: number, ang: number, len: number, w: number, d: number) => {
      if (d <= 0 || len < 6) return;
      const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
      g.lineWidth = w; g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
      branch(x2, y2, ang - (0.2 + r() * 0.4), len * (0.62 + r() * 0.16), w * 0.68, d - 1);
      branch(x2, y2, ang + (0.2 + r() * 0.4), len * (0.62 + r() * 0.16), w * 0.68, d - 1);
    };
    branch(W * 0.38, H * 0.98, -Math.PI / 2, 120, 30, 8);
    for (let i = 0; i < 700; i++) {
      const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * 230;
      g.fillStyle = ['#2f7d3c', '#46a34d', '#7cc36b', '#1f5e32', '#b8d65a'][i % 5];
      g.beginPath(); g.ellipse(W * 0.38 + Math.cos(a) * rr * 1.3, H * 0.36 + Math.sin(a) * rr * 0.5, 5 + r() * 9, 2 + r() * 4, a, 0, Math.PI * 2); g.fill();
    }
    // birds
    for (let i = 0; i < 36; i++) {
      const x = W * (0.05 + r() * 0.9), y = H * (0.05 + r() * 0.55), s = 8 + r() * 14;
      g.fillStyle = ['#1d4fa8', '#2b7bd6', '#123a7a'][i % 3];
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x - s, y - s * 0.8, x - s * 1.6, y - s * 0.1); g.quadraticCurveTo(x - s * 0.6, y + s * 0.1, x, y); g.fill();
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + s, y - s * 0.8, x + s * 1.6, y - s * 0.1); g.quadraticCurveTo(x + s * 0.6, y + s * 0.1, x, y); g.fill();
    }
    // people silhouettes
    g.fillStyle = '#b8472e';
    for (let i = 0; i < 6; i++) { const x = W * 0.62 + i * 52, y = H * 0.8; g.beginPath(); g.arc(x, y - 52, 10, 0, Math.PI * 2); g.fill(); g.fillRect(x - 6, y - 42, 12, 38); }
    g.font = `700 40px ${SANS}`; g.fillStyle = '#fff8e8'; g.textAlign = 'left';
    g.fillText('Community', W * 0.6, H * 0.62); g.fillText('Development', W * 0.6, H * 0.7);
  });

  // --- inner mural (campus side): blue pixel tiles, compass rose + globe, motto, graduates in gowns ---
  const muralInner = A.add(512, 512, (g, W, H) => {
    const r = rng(1946);
    g.fillStyle = '#6aa6d6'; g.fillRect(0, 0, W, H);
    const t = 16;
    for (let y = 0; y < H; y += t) for (let x = 0; x < W; x += t) {
      const v = r();
      g.fillStyle = v < 0.35 ? '#4a90c8' : v < 0.7 ? '#7fb5de' : v < 0.9 ? '#9cc7e8' : '#dcecf7';
      g.fillRect(x, y, t - 1, t - 1);
    }
    // compass rose + globe
    const cx = W * 0.55, cy = H * 0.26, R = 84;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2, len = i % 2 ? R * 0.7 : R * 1.25;
      g.fillStyle = i % 2 ? '#1f2b45' : '#c8342e';
      g.beginPath(); g.moveTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
      g.lineTo(cx + Math.cos(a + 0.5) * R * 0.3, cy + Math.sin(a + 0.5) * R * 0.3);
      g.lineTo(cx + Math.cos(a - 0.5) * R * 0.3, cy + Math.sin(a - 0.5) * R * 0.3); g.fill();
    }
    g.beginPath(); g.arc(cx, cy, R * 0.55, 0, Math.PI * 2); g.fillStyle = '#f4efe0'; g.fill();
    g.beginPath(); g.arc(cx, cy, R * 0.47, 0, Math.PI * 2); g.fillStyle = '#3c78b8'; g.fill();
    g.fillStyle = '#5a9a4a';
    for (let i = 0; i < 9; i++) { g.beginPath(); g.ellipse(cx - 20 + r() * 40, cy - 20 + r() * 40, 6 + r() * 12, 4 + r() * 8, r() * 3, 0, Math.PI * 2); g.fill(); }
    // motto
    g.fillStyle = '#5e4a36'; g.font = `600 17px Georgia, serif`; g.textAlign = 'left';
    g.fillText('Perseverance through Faith', 14, H * 0.2);
    g.fillText('Excellence through Dedication', 14, H * 0.25);
    g.fillText('Service through Humility', 14, H * 0.3);
    // graduates in caps and gowns (greyscale)
    for (let i = 0; i < 9; i++) {
      const x = 24 + i * 54 + r() * 10, base = H - 6, hgt = 170 + r() * 30;
      const grey = 70 + Math.floor(r() * 90);
      g.fillStyle = `rgb(${grey},${grey},${grey + 6})`;
      g.beginPath(); g.moveTo(x - 20, base); g.lineTo(x - 15, base - hgt * 0.72); g.lineTo(x + 15, base - hgt * 0.72); g.lineTo(x + 20, base); g.fill();
      g.beginPath(); g.arc(x, base - hgt * 0.8, 12, 0, Math.PI * 2); g.fillStyle = `rgb(${grey + 60},${grey + 55},${grey + 50})`; g.fill();
      g.fillStyle = '#1c1c1e'; g.fillRect(x - 15, base - hgt * 0.8 - 16, 30, 5); g.fillRect(x - 6, base - hgt * 0.8 - 14, 12, 6);
    }
  });

  const building = new Map<string, UV>();
  for (const s of buildingSigns) {
    building.set(s.id, A.add(640, s.sub ? 160 : 110, (g, w, h) => {
      g.fillStyle = s.color; g.textAlign = 'center'; g.textBaseline = 'middle';
      fitText(g, s.text, w * 0.95, s.sub ? 74 : 84, '800', SANS);
      g.fillText(s.text, w / 2, s.sub ? h * 0.36 : h / 2);
      if (s.sub) { fitText(g, s.sub, w * 0.95, 40, '600', SANS); g.fillText(s.sub, w / 2, h * 0.78); }
    }));
  }
  A.pack();
  return { gateBeamEast, gateBeamWest, gatePillarText, gateBanner, pesBridge, bblockCrest, mrdCanopy, pesSociety, porteBanner, quadBanner, lawSign, fBlockRoof, muralOuter, muralInner, guardBooth, building };
}
