// Procesa una arcada .glb:
//  1. Clasifica cada vértice como diente o encía según la textura original.
//  2. Calcula curvatura (surcos = cóncavo, cúspides = convexo) y distancia al margen gingival.
//  3. Hornea colores por vértice: esmalte, dentina cervical, fisuras, encía marginal.
//  4. Separa la malla en dos primitivas con materiales "esmalte" y "encia".
//  5. Mide cada pieza (ancho, nivel cervical) y escribe un JSON para generar raíces en el visor.
// Uso: node procesar_arcadas.mjs <entrada.glb> <posiciones.json> <salida.glb> <salida_raices.json>
import fs from 'fs';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRDracoMeshCompression } from '@gltf-transform/extensions';
import { prune, simplifyPrimitive } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';

const [inFile, posFile, outFile, rootsFile, proxyFile, modo] = process.argv.slice(2);
const LITE = modo === 'lite';                       // versión ligera para móviles
const RATIO_DIENTES = +(process.env.RD || (LITE ? 0.18 : 0.62)), RATIO_ENCIA = +(process.env.RE || (LITE ? 0.07 : 0.22));
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'draco3d.encoder': await draco3d.createEncoderModule(),
});
const doc = await io.read(inFile);
const root = doc.getRoot();
const mesh = root.listMeshes()[0];
const prim = mesh.listPrimitives()[0];
const oldMat = prim.getMaterial();
const P = prim.getAttribute('POSITION').getArray();
const N = prim.getAttribute('NORMAL').getArray();
const UV = prim.getAttribute('TEXCOORD_0').getArray();
const I = prim.getIndices().getArray();
const nV = P.length / 3, nT = I.length / 3;
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

// Las posiciones del JSON están en espacio de escena: aplicar la transformación del nodo (p. ej. espejo en Y).
const meshNode = root.listNodes().find(n => n.getMesh() === mesh);
const M = meshNode ? meshNode.getWorldMatrix() : [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
const Pw = new Float32Array(P.length);
for (let i = 0; i < nV; i++) {
  const x = P[3 * i], y = P[3 * i + 1], z = P[3 * i + 2];
  Pw[3 * i] = M[0] * x + M[4] * y + M[8] * z + M[12];
  Pw[3 * i + 1] = M[1] * x + M[5] * y + M[9] * z + M[13];
  Pw[3 * i + 2] = M[2] * x + M[6] * y + M[10] * z + M[14];
}
const pos = JSON.parse(fs.readFileSync(posFile, 'utf8'));
const fdis = Object.keys(pos);

// ---------- adyacencia (CSR) ----------
const deg = new Uint32Array(nV);
for (let t = 0; t < nT; t++) { deg[I[3 * t]] += 2; deg[I[3 * t + 1]] += 2; deg[I[3 * t + 2]] += 2; }
const off = new Uint32Array(nV + 1);
for (let i = 0; i < nV; i++) off[i + 1] = off[i] + deg[i];
const adj = new Uint32Array(off[nV]);
const fill = off.slice(0, nV);
for (let t = 0; t < nT; t++) {
  const a = I[3 * t], b = I[3 * t + 1], c = I[3 * t + 2];
  adj[fill[a]++] = b; adj[fill[a]++] = c;
  adj[fill[b]++] = a; adj[fill[b]++] = c;
  adj[fill[c]++] = a; adj[fill[c]++] = b;
}
log('adyacencia', nV, 'vértices', nT, 'triángulos');

// ---------- clasificación diente / encía sobre una copia soldada ----------
const tex = oldMat.getBaseColorTexture();
const { data: px, info } = await sharp(Buffer.from(tex.getImage())).raw().toBuffer({ resolveWithObject: true });
const texRG = new Float32Array(nV), lum = new Float32Array(nV);
for (let i = 0; i < nV; i++) {
  const x = Math.min(info.width - 1, Math.max(0, Math.floor(UV[2 * i] * info.width)));
  const y = Math.min(info.height - 1, Math.max(0, Math.floor(UV[2 * i + 1] * info.height)));
  const o = (y * info.width + x) * info.channels;
  texRG[i] = px[o] - px[o + 1];
  lum[i] = (px[o] + px[o + 1] + px[o + 2]) / 765;
}
// 1 · Soldar (solo para decidir)
const qS = 1e5, mapaS = new Map(), wId = new Int32Array(nV);
let nSold = 0; const wPrim = [];
for (let i = 0; i < nV; i++) {
  const k = Math.round(P[3 * i] * qS) + ',' + Math.round(P[3 * i + 1] * qS) + ',' + Math.round(P[3 * i + 2] * qS);
  let u = mapaS.get(k);
  if (u === undefined) { u = nSold++; mapaS.set(k, u); wPrim.push(i); }
  wId[i] = u;
}
const wCnt = new Float32Array(nSold), wRG = new Float32Array(nSold), wN = new Float32Array(nSold * 3);
for (let i = 0; i < nV; i++) { const u = wId[i]; wCnt[u]++; wRG[u] += texRG[i]; wN[3*u] += N[3*i]; wN[3*u+1] += N[3*i+1]; wN[3*u+2] += N[3*i+2]; }
for (let u = 0; u < nSold; u++) { wRG[u] /= wCnt[u]; const l = Math.hypot(wN[3*u], wN[3*u+1], wN[3*u+2]) || 1; wN[3*u] /= l; wN[3*u+1] /= l; wN[3*u+2] /= l; }
const wP = new Float32Array(nSold * 3), wPw = new Float32Array(nSold * 3);
for (let u = 0; u < nSold; u++) { const i = wPrim[u]; for (let a = 0; a < 3; a++) { wP[3*u+a] = P[3*i+a]; wPw[3*u+a] = Pw[3*i+a]; } }
// Vecindad soldada
const wDeg = new Uint32Array(nSold);
for (let t = 0; t < nT; t++) { const a = wId[I[3*t]], b = wId[I[3*t+1]], c = wId[I[3*t+2]]; if (a === b || b === c || a === c) continue; wDeg[a] += 2; wDeg[b] += 2; wDeg[c] += 2; }
const wOff = new Uint32Array(nSold + 1); for (let u = 0; u < nSold; u++) wOff[u + 1] = wOff[u] + wDeg[u];
const wAdj = new Uint32Array(wOff[nSold]); const wFill = wOff.slice(0, nSold);
for (let t = 0; t < nT; t++) {
  const a = wId[I[3*t]], b = wId[I[3*t+1]], c = wId[I[3*t+2]]; if (a === b || b === c || a === c) continue;
  wAdj[wFill[a]++] = b; wAdj[wFill[a]++] = c; wAdj[wFill[b]++] = a; wAdj[wFill[b]++] = c; wAdj[wFill[c]++] = a; wAdj[wFill[c]++] = b;
}
log('copia soldada:', nV, '→', nSold, 'vértices');
// 2 · Curvatura (cóncavo = positivo) en la copia soldada; la costura se rellena
let cv = new Float32Array(nSold);
for (let u = 0; u < nSold; u++) {
  let sx = 0, sy = 0, sz = 0, el = 0; const c = wOff[u + 1] - wOff[u]; if (!c) continue;
  for (let k = wOff[u]; k < wOff[u + 1]; k++) { const w = wAdj[k]; const dx = wP[3*w] - wP[3*u], dy = wP[3*w+1] - wP[3*u+1], dz = wP[3*w+2] - wP[3*u+2]; sx += dx; sy += dy; sz += dz; el += Math.hypot(dx, dy, dz); }
  el /= c; cv[u] = (wN[3*u] * sx + wN[3*u+1] * sy + wN[3*u+2] * sz) / c / (el || 1);
}
const wCost = new Uint8Array(nSold);
for (let u = 0; u < nSold; u++) if (wCnt[u] > 1) { wCost[u] = 1; for (let k = wOff[u]; k < wOff[u + 1]; k++) wCost[wAdj[k]] = 1; }
for (let it = 0; it < 6; it++) {
  const g = cv.slice();
  for (let u = 0; u < nSold; u++) { if (!wCost[u]) continue; let a = 0, c = 0; for (let k = wOff[u]; k < wOff[u + 1]; k++) { const w = wAdj[k]; if (!wCost[w] || it > 2) { a += cv[w]; c++; } } if (c) g[u] = a / c; }
  cv = g;
}
for (let it = 0; it < 4; it++) {
  const nx = new Float32Array(nSold);
  for (let u = 0; u < nSold; u++) { let a = cv[u], c = 1; for (let k = wOff[u]; k < wOff[u + 1]; k++) { a += cv[wAdj[k]]; c++; } nx[u] = a / c; }
  cv = nx;
}
const mu = []; for (let u = 0; u < nSold; u += 11) mu.push(cv[u]); mu.sort((a, b) => a - b);
const escala = Math.max(1e-6, mu[Math.floor(0.985 * (mu.length - 1))]);
const elev = new Float32Array(nSold);
for (let u = 0; u < nSold; u++) elev[u] = Math.max(0, cv[u]) / escala;
// 3 · Semillas: dientes por posición; encía solo lejos de los dientes
const tp = fdis.map(f => [pos[f].x, pos[f].y, pos[f].z]);
const radio = tp.map((p, a) => { let m = 1e9; tp.forEach((q, b) => { if (a !== b) m = Math.min(m, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])); }); return Math.min(+(process.env.RMAX || 0.12), Math.max(0.04, +(process.env.RSEM || 0.5) * m)); });
const semD = [], semG = [];
for (let u = 0; u < nSold; u++) {
  let dent = false, dmin = 1e9;
  for (let t = 0; t < tp.length; t++) { const d = Math.hypot(wPw[3*u] - tp[t][0], wPw[3*u+1] - tp[t][1], wPw[3*u+2] - tp[t][2]); if (d < radio[t]) dent = true; if (d < dmin) dmin = d; }
  if (dent) semD.push(u); else if (dmin > 0.14 && wRG[u] > 55) semG.push(u);
}
log('semillas: dientes', semD.length, '· encía', semG.length);
// 4 · Dos Dijkstra: gana quien llega más barato; cruzar un pliegue cuesta caro
const ALFA = +(process.env.ALFA || 30), GAMMA = +(process.env.GAMMA || 2);
const texW = new Float32Array(nSold);
for (let u = 0; u < nSold; u++) texW[u] = Math.min(1, Math.max(0, (wRG[u] - 18) / 40));
const dijkstra = (semillas, esDiente) => {
  const dist = new Float64Array(nSold).fill(Infinity);
  let cap = 1 << 22, hK = new Float64Array(cap), hV = new Int32Array(cap), hN = 0;
  const push = (v, k) => { if (hN >= cap) { cap *= 2; const k2 = new Float64Array(cap); k2.set(hK); hK = k2; const v2 = new Int32Array(cap); v2.set(hV); hV = v2; } let i = hN++; while (i > 0) { const p = (i - 1) >> 1; if (hK[p] <= k) break; hK[i] = hK[p]; hV[i] = hV[p]; i = p; } hK[i] = k; hV[i] = v; };
  const pop = () => { const v = hV[0], k0 = hK[0], k = hK[--hN], w = hV[hN]; let i = 0; while (true) { let c = 2 * i + 1; if (c >= hN) break; if (c + 1 < hN && hK[c + 1] < hK[c]) c++; if (hK[c] >= k) break; hK[i] = hK[c]; hV[i] = hV[c]; i = c; } hK[i] = k; hV[i] = w; return [v, k0]; };
  for (const v of semillas) { dist[v] = 0; push(v, 0); }
  while (hN) {
    const [u, d] = pop(); if (d > dist[u]) continue;
    for (let k = wOff[u]; k < wOff[u + 1]; k++) {
      const w = wAdj[k];
      const len = Math.hypot(wP[3*w] - wP[3*u], wP[3*w+1] - wP[3*u+1], wP[3*w+2] - wP[3*u+2]);
      const nd = d + len * (1 + ALFA * elev[w] + GAMMA * (esDiente ? texW[w] : 1 - texW[w]));
      if (nd < dist[w]) { dist[w] = nd; push(w, nd); }
    }
  }
  return dist;
};
const cD = dijkstra(semD, true), cG = dijkstra(semG, false);
let wGum = new Uint8Array(nSold);
for (let u = 0; u < nSold; u++) wGum[u] = cG[u] < cD[u] ? 1 : 0;
// 5 · Limpieza en la copia soldada
for (let it = 0; it < 2; it++) {
  const nx = new Uint8Array(nSold);
  for (let u = 0; u < nSold; u++) { let a = wGum[u] * 2, c = 2; for (let k = wOff[u]; k < wOff[u + 1]; k++) { a += wGum[wAdj[k]]; c++; } nx[u] = a * 2 > c ? 1 : 0; }
  wGum = nx;
}
for (const [label, minSize] of [[1, 3000], [0, 1200]]) {
  const seen = new Uint8Array(nSold);
  for (let s0 = 0; s0 < nSold; s0++) {
    if (seen[s0] || wGum[s0] !== label) continue;
    const comp = [s0]; seen[s0] = 1;
    for (let q = 0; q < comp.length; q++) { const u = comp[q]; for (let k = wOff[u]; k < wOff[u + 1]; k++) { const w = wAdj[k]; if (!seen[w] && wGum[w] === label) { seen[w] = 1; comp.push(w); } } }
    if (comp.length < minSize) for (const u of comp) wGum[u] = 1 - label;
  }
}
// 6 · De vuelta a la malla original (todas las copias de un vértice, misma clase)
let gum = new Uint8Array(nV);
for (let i = 0; i < nV; i++) gum[i] = wGum[wId[i]];
{ let ac = 0; for (let i = 0; i < nV; i++) if ((texRG[i] > 32 ? 1 : 0) === gum[i]) ac++; log('coincidencia con la textura:', (100 * ac / nV).toFixed(1) + '%'); }
log('encía', gum.reduce((a, b) => a + b, 0), 'vértices');

const nrm = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// ---------- curvatura ----------
let curv = new Float32Array(nV);
const edgeLen = new Float32Array(nV);
for (let i = 0; i < nV; i++) {
  let sx = 0, sy = 0, sz = 0, el = 0; const c = off[i + 1] - off[i];
  if (!c) continue;
  for (let k = off[i]; k < off[i + 1]; k++) {
    const j = adj[k];
    const dx = P[3 * j] - P[3 * i], dy = P[3 * j + 1] - P[3 * i + 1], dz = P[3 * j + 2] - P[3 * i + 2];
    sx += dx; sy += dy; sz += dz; el += Math.hypot(dx, dy, dz);
  }
  el /= c; edgeLen[i] = el;
  curv[i] = (N[3 * i] * sx + N[3 * i + 1] * sy + N[3 * i + 2] * sz) / c / (el || 1);
}
const smoothField = (field, iters) => {
  let f = field;
  for (let it = 0; it < iters; it++) {
    const next = new Float32Array(nV);
    for (let i = 0; i < nV; i++) {
      let s = f[i], c = 1;
      for (let k = off[i]; k < off[i + 1]; k++) { if (gum[adj[k]] === gum[i]) { s += f[adj[k]]; c++; } }
      next[i] = s / c;
    }
    f = next;
  }
  return f;
};
const rawCurv = curv;
curv = smoothField(rawCurv, 3);            // escala fina: fisuras y surcos
const broad = smoothField(rawCurv, 24);    // escala amplia: fosas, troneras y cara oclusal
const pct = (arr, mask, p) => {
  const v = []; for (let i = 0; i < arr.length; i += 7) if (mask(i)) v.push(arr[i]);
  v.sort((a, b) => a - b); return v[Math.floor(p * (v.length - 1))];
};
const kT = { g0: pct(curv, i => !gum[i], 0.70), g1: pct(curv, i => !gum[i], 0.985), c0: pct(curv, i => !gum[i], 0.30), c1: pct(curv, i => !gum[i], 0.02) };
const kG = { g0: pct(curv, i => gum[i], 0.70), g1: pct(curv, i => gum[i], 0.98) };
const kB = { g0: pct(broad, i => !gum[i], 0.55), g1: pct(broad, i => !gum[i], 0.97), c0: pct(broad, i => !gum[i], 0.35), c1: pct(broad, i => !gum[i], 0.03) };
log('curvatura', kT, kG);

const mean = [0, 0, 0], tMean = [0, 0, 0], gMean = [0, 0, 0]; let cnt = 0, tc = 0, gc = 0;
for (let i = 0; i < nV; i += 5) {
  const v = [Pw[3 * i], Pw[3 * i + 1], Pw[3 * i + 2]];
  for (let a = 0; a < 3; a++) mean[a] += v[a]; cnt++;
  if (gum[i]) { for (let a = 0; a < 3; a++) gMean[a] += v[a]; gc++; } else { for (let a = 0; a < 3; a++) tMean[a] += v[a]; tc++; }
}
for (let a = 0; a < 3; a++) { mean[a] /= cnt; tMean[a] /= tc; gMean[a] /= gc; }
// Suma de normales de las coronas: cada corona es una cúpula abierta hacia la raíz,
// así que la suma apunta en sentido oclusal a lo largo del eje de la pieza.
const nW = i => { const x = N[3 * i], y = N[3 * i + 1], z = N[3 * i + 2]; return [M[0] * x + M[4] * y + M[8] * z, M[1] * x + M[5] * y + M[9] * z, M[2] * x + M[6] * y + M[10] * z]; };
let up = [0, 0, 0];
for (let i = 0; i < nV; i++) { if (gum[i]) continue; const n = nW(i); up[0] += n[0]; up[1] += n[1]; up[2] += n[2]; }
up = nrm(up);
if (dot(up, [tMean[0] - gMean[0], tMean[1] - gMean[1], tMean[2] - gMean[2]]) < 0) up = up.map(x => -x);
if (pos[fdis[0]].nx !== undefined) {
  let n = [0, 0, 0];
  for (const f of fdis) { n[0] += pos[f].nx; n[1] += pos[f].ny; n[2] += pos[f].nz; }
  log('eje oclusal (geometría vs. normales del JSON):', up.map(x => x.toFixed(3)), nrm(n).map(x => x.toFixed(3)));
} else log('eje oclusal', up.map(x => x.toFixed(3)));

// ---------- distancia al margen diente/encía ----------
const dist = new Float32Array(nV).fill(1e9);
const srcH = new Float32Array(nV);
const hOf = i => Pw[3 * i] * up[0] + Pw[3 * i + 1] * up[1] + Pw[3 * i + 2] * up[2];
let frontier = [];
for (let i = 0; i < nV; i++) {
  for (let k = off[i]; k < off[i + 1]; k++) if (gum[adj[k]] !== gum[i]) { dist[i] = 0; srcH[i] = hOf(i); frontier.push(i); break; }
}
const MAXD = 0.6;
while (frontier.length) {
  const nf = [];
  for (const i of frontier) {
    for (let k = off[i]; k < off[i + 1]; k++) {
      const j = adj[k];
      if (gum[j] !== gum[i]) continue;
      const d = dist[i] + Math.hypot(P[3 * j] - P[3 * i], P[3 * j + 1] - P[3 * i + 1], P[3 * j + 2] - P[3 * i + 2]);
      if (d < dist[j] && d < MAXD) { dist[j] = d; srcH[j] = srcH[i]; nf.push(j); }
    }
  }
  frontier = nf;
}
log('distancias al margen listas');

// ---------- colores por vértice (lineales) ----------
const lin = h => [0, 2, 4].map(s => { const c = parseInt(h.slice(1 + s, 3 + s), 16) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
const ESMALTE = lin('#F1E9DC'), DENTINA = lin('#EFDDBE'), FISURA = lin('#9C7D57'), FOSA = lin('#D6C09A'), BORDE = lin('#E8E5DE');
const RAIZ = lin('#E8D4B9');
const ENCIA = lin('#EDB2AF'), MARGEN = lin('#E49CA0'), SURCO_ENCIA = lin('#CD868C');
const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const COL = new Float32Array(nV * 3);
const ZONA = new Uint8Array(nV); // 0 encía insertada 1 encía marginal 2 cúspide/borde 3 surco 4 cuerpo 5 cuello 6 raíz
for (let i = 0; i < nV; i++) {
  let c;
  if (!gum[i]) {
    c = ESMALTE;
    c = mix(c, DENTINA, 0.5 * (1 - ss(0.0, 0.11, dist[i])));   // tercio cervical: el esmalte es más delgado y la dentina se transparenta
    c = mix(c, FOSA, 0.65 * ss(kB.g0, kB.g1, broad[i]));        // fosas y troneras (sombra amplia)
    c = mix(c, BORDE, 0.55 * ss(kB.c0, kB.c1, broad[i]) + 0.3 * ss(kT.c0, kT.c1, curv[i])); // cúspides y bordes: esmalte más translúcido
    c = mix(c, FISURA, 0.82 * ss(kT.g0, kT.g1, curv[i]));      // surcos y fisuras
  } else {
    c = ENCIA;
    c = mix(c, MARGEN, 0.45 * (1 - ss(0.0, 0.055, dist[i])));   // encía marginal y papilas
    c = mix(c, SURCO_ENCIA, 0.45 * ss(kG.g0, kG.g1, curv[i]));
    const v = 0.94 + 0.1 * lum[i];                              // variación suave tomada de la textura original
    c = [c[0] * v, c[1] * v, c[2] * v];
  }
  COL[3 * i] = c[0]; COL[3 * i + 1] = c[1]; COL[3 * i + 2] = c[2];
  if (gum[i]) ZONA[i] = dist[i] < 0.035 ? 1 : 0;
  else if (dist[i] < 0.045) ZONA[i] = 5;
  else if (ss(kT.g0, kT.g1, curv[i]) > 0.5) ZONA[i] = 3;
  else if (ss(kB.c0, kB.c1, broad[i]) > 0.5) ZONA[i] = 2;
  else ZONA[i] = 4;
}

// ---------- separar en dos primitivas ----------
const teethIdx = [], gumIdx = [];
for (let t = 0; t < nT; t++) {
  const a = I[3 * t], b = I[3 * t + 1], c = I[3 * t + 2];
  ((gum[a] + gum[b] + gum[c]) >= 2 ? gumIdx : teethIdx).push(a, b, c);
}
const buf = root.listBuffers()[0];
const clon = (nombre, acc) => doc.createAccessor(nombre).setType(acc.getType()).setArray(acc.getArray().slice()).setBuffer(buf);
// Sin texturas: el color va por vértice y el relieve lo da la propia malla
const mEsmalte = doc.createMaterial('esmalte').setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.3).setMetallicFactor(0).setDoubleSided(false);
const mEncia = doc.createMaterial('encia').setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.5).setMetallicFactor(0).setDoubleSided(false);

const colAcc = doc.createAccessor('color').setType('VEC3').setArray(COL).setBuffer(buf);
const zonaAcc = doc.createAccessor('zona').setType('SCALAR').setArray(new Float32Array(ZONA)).setBuffer(buf);
prim.setAttribute('COLOR_0', colAcc).setAttribute('_ZONA', zonaAcc)
  .setAttribute('TEXCOORD_0', null).setAttribute('TANGENT', null)
  .setIndices(doc.createAccessor('idx_dientes').setType('SCALAR').setArray(new Uint32Array(teethIdx)).setBuffer(buf))
  .setMaterial(mEsmalte);

// La encía lleva copias propias de los atributos: cada primitiva se simplifica por separado
const gumPrim = doc.createPrimitive().setMaterial(mEncia)
  .setIndices(doc.createAccessor('idx_encia').setType('SCALAR').setArray(new Uint32Array(gumIdx)).setBuffer(buf));
for (const sem of prim.listSemantics()) gumPrim.setAttribute(sem, clon(sem.toLowerCase() + '_encia', prim.getAttribute(sem)));
mesh.addPrimitive(gumPrim);
oldMat.dispose();

// Menos polígonos donde no se nota (encía) y detalle donde sí (dientes)
const antes = [teethIdx.length / 3, gumIdx.length / 3];
await simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: RATIO_DIENTES, error: 0.0004, lockBorder: true });
await simplifyPrimitive(gumPrim, { simplifier: MeshoptSimplifier, ratio: RATIO_ENCIA, error: 0.0015, lockBorder: true });
await doc.transform(prune());
log('simplificado: dientes', antes[0], '→', prim.getIndices().getCount() / 3, '· encía', antes[1], '→', gumPrim.getIndices().getCount() / 3);


// ---------- medir cada pieza para las raíces ----------

// Dirección oclusal = eje de menor varianza de la arcada (es un "herradura" casi plana),
// orientado desde la encía hacia las coronas.
const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
for (let i = 0; i < nV; i += 5) {
  const d = [Pw[3 * i] - mean[0], Pw[3 * i + 1] - mean[1], Pw[3 * i + 2] - mean[2]];
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a][b] += d[a] * d[b] / cnt;
}
const tr = C[0][0] + C[1][1] + C[2][2];
// Orden anatómico a lo largo de la arcada para calcular la tangente
const ordered = [...fdis].sort((a, b) => {
  const q = f => (Math.floor(f / 10) % 2 === 1 ? -1 : 1) * (f % 10); // cuadrantes 1/3/5/7 hacia un lado
  return q(+a) - q(+b);
});
const flat = (v, p) => { const d = [v[0] - p[0], v[1] - p[1], v[2] - p[2]]; const h = dot(d, up); return [d[0] - up[0] * h, d[1] - up[1] * h, d[2] - up[2] * h]; };
const buckets = Object.fromEntries(fdis.map(f => [f, []]));
for (let i = 0; i < nV; i++) {
  if (gum[i]) continue;
  const v = [Pw[3 * i], Pw[3 * i + 1], Pw[3 * i + 2]];
  let best = null, bd = 0.12;
  for (const f of fdis) { const d = Math.hypot(...flat(v, [pos[f].x, pos[f].y, pos[f].z])); if (d < bd) { bd = d; best = f; } }
  if (best) buckets[best].push(i);
}
const roots = { up, piezas: {} };
ordered.forEach((f, k) => {
  const p = [pos[f].x, pos[f].y, pos[f].z];
  const prev = ordered[Math.max(0, k - 1)], next = ordered[Math.min(ordered.length - 1, k + 1)];
  let tan = nrm(flat([pos[next].x, pos[next].y, pos[next].z], [pos[prev].x, pos[prev].y, pos[prev].z]));
  const bin = nrm(cross(up, tan));
  const vs = buckets[f];
  if (vs.length < 50) return;
  const hs = [], ts = [], bs = []; let cx = 0, cy = 0, cz = 0;
  for (const i of vs) {
    const d = [Pw[3 * i] - p[0], Pw[3 * i + 1] - p[1], Pw[3 * i + 2] - p[2]];
    hs.push(dot(d, up)); ts.push(dot(d, tan)); bs.push(dot(d, bin));
    cx += Pw[3 * i]; cy += Pw[3 * i + 1]; cz += Pw[3 * i + 2];
  }
  const q = (a, p2) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(p2 * (s.length - 1))]; };
  let ax = [0, 0, 0];
  for (const i of vs) { const n = nW(i); ax[0] += n[0]; ax[1] += n[1]; ax[2] += n[2]; }
  ax = nrm(ax); if (dot(ax, up) < 0) ax = ax.map(x => -x);
  const eje = nrm([0, 1, 2].map(k => 0.5 * ax[k] + 0.5 * up[k])); // eje propio de la pieza, suavizado con el de la arcada
  const cervical = q(hs, 0.03), crownH = q(hs, 0.99) - cervical;
  const c = [cx / vs.length, cy / vs.length, cz / vs.length];
  const hc = dot([c[0] - p[0], c[1] - p[1], c[2] - p[2]], up);
  // punto en el eje de la pieza a la altura cervical
  const base = [c[0] + up[0] * (cervical - hc), c[1] + up[1] * (cervical - hc), c[2] + up[2] * (cervical - hc)];
  roots.piezas[f] = {
    eje: eje.map(x => +x.toFixed(4)),
    base: base.map(x => +x.toFixed(5)), tan: tan.map(x => +x.toFixed(4)), bin: bin.map(x => +x.toFixed(4)),
    ancho: +(q(ts, 0.97) - q(ts, 0.03)).toFixed(4), grosor: +(q(bs, 0.97) - q(bs, 0.03)).toFixed(4), altoCorona: +crownH.toFixed(4),
  };
});
roots.up = up.map(x => +x.toFixed(4));
fs.writeFileSync(rootsFile, JSON.stringify(roots, null, 1));
log('raíces medidas', Object.keys(roots.piezas).length, 'piezas');

const draco = doc.createExtension(KHRDracoMeshCompression).setRequired(true)
  .setEncoderOptions({ method: KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER, encodeSpeed: 3, decodeSpeed: 5,
    quantizationVolume: "scene", quantizationBits: { POSITION: +(process.env.QB || 14), NORMAL: 10, COLOR: 8, TEX_COORD: 10, GENERIC: 8 } });

// ---------- malla-proxy: copia muy ligera solo para el cursor y la selección ----------
// Evita tener que lanzar rayos contra los 3 millones de triángulos del escaneo.
if (proxyFile) {
  const fdiOf = new Float32Array(nV);
  for (const f of fdis) for (const i of (buckets[f] || [])) fdiOf[i] = +f;
  const construir = (tris, objetivo) => {
    const idx = new Uint32Array(tris);
    log('proxy in:', idx.length, idx.length % 3, objetivo, objetivo % 3, Pw.length, Pw.length % 3);
    const meta = Math.max(3, Math.floor(objetivo / 3) * 3);   // múltiplo de 3
    const [simplificado] = MeshoptSimplifier.simplify(idx, Pw, 3, meta, 0.08, ["LockBorder"]);
    const mapa = new Map(); const pos = [], zon = [], fdi = [], out = [];
    for (const v of simplificado) {
      if (!mapa.has(v)) {
        mapa.set(v, pos.length / 3);
        pos.push(Pw[3 * v], Pw[3 * v + 1], Pw[3 * v + 2]);
        zon.push(ZONA[v]); fdi.push(fdiOf[v]);
      }
      out.push(mapa.get(v));
    }
    return { pos: new Float32Array(pos), zon: new Float32Array(zon), fdi: new Float32Array(fdi), idx: new Uint32Array(out) };
  };
  const dientes = construir(teethIdx, 9000);
  const encia = construir(gumIdx, 3000);
  const pDoc = new Document();
  const pBuf = pDoc.createBuffer();
  const pMesh = pDoc.createMesh('proxy');
  for (const [nombre, d] of [['proxy_dientes', dientes], ['proxy_encia', encia]]) {
    const p = pDoc.createPrimitive()
      .setAttribute('POSITION', pDoc.createAccessor(nombre + '_pos').setType('VEC3').setArray(d.pos).setBuffer(pBuf))
      .setAttribute('_ZONA', pDoc.createAccessor(nombre + '_zona').setType('SCALAR').setArray(d.zon).setBuffer(pBuf))
      .setAttribute('_FDI', pDoc.createAccessor(nombre + '_fdi').setType('SCALAR').setArray(d.fdi).setBuffer(pBuf))
      .setIndices(pDoc.createAccessor(nombre + '_idx').setType('SCALAR').setArray(d.idx).setBuffer(pBuf))
      .setMaterial(pDoc.createMaterial(nombre));
    pMesh.addPrimitive(p);
  }
  pDoc.createScene().addChild(pDoc.createNode('proxy_node').setMesh(pMesh));
  // Comprimida igual que las arcadas (con más bits en los atributos propios,
  // para que el número de pieza no se deforme al cuantizar)
  pDoc.createExtension(KHRDracoMeshCompression).setRequired(true)
    .setEncoderOptions({ quantizationVolume: 'scene', quantizationBits: { POSITION: 14, GENERIC: 16 } });
  await io.write(proxyFile, pDoc);
  log('proxy', (dientes.idx.length + encia.idx.length) / 3, 'triángulos ·', (fs.statSync(proxyFile).size / 1024).toFixed(0), 'KB');
}

await io.write(outFile, doc);
log('escrito', outFile, (fs.statSync(outFile).size / 1e6).toFixed(1), 'MB');
