const CELL_BASALT = 0;
const CELL_EMPTY  = 1;
const BASE_TILE_SUBCELLS = 8;

class TerrainRenderer {
    constructor() {
        this.ready       = false;
        this._cols       = 0;
        this._rows       = 0;
        this._cells      = null;
        this._loops      = null;
        this._loopOuter  = null;
        this._facets     = null;
        this._minerals   = null;
        this._crackPath  = null;
        this._noiseTile  = null;
        this._bbox       = null;
        this._silFull    = null;
        this._silOuter   = null;
        this._lineRocks   = null;
    }

    _h(x, y, s) {
        let h = (Math.imul(x+1, 374761393) ^ Math.imul(y+1, 1284865837) ^ Math.imul((s|0)+1, 668265263)) | 0;
        h = Math.imul(h ^ (h >>> 13), 1540483477);
        h ^= h >>> 15;
        return (h >>> 0) / 0x100000000;
    }

    _sn(x, y, s) {
        const xi = Math.floor(x), yi = Math.floor(y);
        const xf = x - xi, yf = y - yi;
        const ux = xf * xf * (3 - 2 * xf);
        const uy = yf * yf * (3 - 2 * yf);
        const a  = this._h(xi,   yi,   s);
        const b  = this._h(xi+1, yi,   s);
        const c  = this._h(xi,   yi+1, s);
        const dd = this._h(xi+1, yi+1, s);
        return a*(1-ux)*(1-uy) + b*ux*(1-uy) + c*(1-ux)*uy + dd*ux*uy;
    }

    _fbm(x, y, octaves, seed) {
        let v = 0, amp = 0.5, freq = 1;
        for (let i = 0; i < octaves; i++) {
            v    += (this._sn(x * freq, y * freq, seed + i) - 0.5) * amp;
            amp  *= 0.5;
            freq *= 2.17;
        }
        return v + 0.5;
    }

    _solid(c, r) {
        if (c < 0 || c >= this._cols || r < 0 || r >= this._rows) return false;
        return this._cells[r * this._cols + c] === CELL_BASALT;
    }

    init(cells, cols, rows) {
        this._cols  = cols;
        this._rows  = rows;
        this._cells = new Uint8Array(cells);
        this._lineRocks = null;
        if (!this._noiseTile) this._buildNoiseTile();
        this._buildContours();
        this._buildFacets();
        this.ready = true;
    }

    _buildNoiseTile() {
        const S = 512;
        const cv = document.createElement('canvas');
        cv.width = cv.height = S;
        const ctx = cv.getContext('2d');
        const img = ctx.createImageData(S, S);
        const d = img.data;

        const GS = 20, cell = S / GS;
        const fx = [], fy = [];
        for (let gy = 0; gy < GS; gy++) {
            fx[gy] = []; fy[gy] = [];
            for (let gx = 0; gx < GS; gx++) { fx[gy][gx] = Math.random() * cell; fy[gy][gx] = Math.random() * cell; }
        }
        const lx = -0.7, ly = -0.7;

        for (let y = 0; y < S; y++) {
            for (let x = 0; x < S; x++) {
                const gx0 = Math.floor(x / cell), gy0 = Math.floor(y / cell);
                let f1 = 1e9, f2 = 1e9, nsx = 0, nsy = 0;
                for (let dgy = -1; dgy <= 1; dgy++) {
                    for (let dgx = -1; dgx <= 1; dgx++) {
                        const nx = gx0 + dgx, ny = gy0 + dgy;
                        const wx = ((nx % GS) + GS) % GS, wy = ((ny % GS) + GS) % GS;
                        const sx = nx * cell + fx[wy][wx], sy = ny * cell + fy[wy][wx];
                        const dx = x - sx, dy = y - sy, dd = dx * dx + dy * dy;
                        if (dd < f1) { f2 = f1; f1 = dd; nsx = dx; nsy = dy; }
                        else if (dd < f2) { f2 = dd; }
                    }
                }
                f1 = Math.sqrt(f1); f2 = Math.sqrt(f2);
                const nl = Math.hypot(nsx, nsy) || 1;
                const lightDot = (nsx / nl) * lx + (nsy / nl) * ly;
                const edge = (f2 - f1) / cell;

                let shade = 0.5 + lightDot * 0.30;
                shade -= (f1 / cell) * 0.10;
                if (edge < 0.16) shade -= (1 - edge / 0.16) * 0.32;
                shade += (Math.random() - 0.5) * 0.08;
                shade = Math.max(0.06, Math.min(0.94, shade));

                const gr = (shade * 255) | 0;
                const i = (y * S + x) * 4;
                d[i] = d[i+1] = d[i+2] = gr;
                d[i+3] = 255;
            }
        }
        ctx.putImageData(img, 0, 0);
        this._noiseTile = cv;
    }

    updateCell(col, row, newType) {
        if (!this.ready) return;
        if (col < 0 || col >= this._cols || row < 0 || row >= this._rows) return;
        this._cells[row * this._cols + col] = newType;
        this._buildContours();
        this._buildFacets();
    }

    _buildContours() {
        const cols = this._cols, rows = this._rows;
        const edges = [];
        const startMap = new Map();
        const addE = (ax, ay, bx, by) => {
            const i = edges.length;
            edges.push([ax, ay, bx, by]);
            const k = ax + ',' + ay;
            let a = startMap.get(k);
            if (!a) { a = []; startMap.set(k, a); }
            a.push(i);
        };

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (!this._solid(c, r)) continue;
                if (!this._solid(c,   r-1)) addE(c,   r,   c+1, r);
                if (!this._solid(c+1, r))   addE(c+1, r,   c+1, r+1);
                if (!this._solid(c,   r+1)) addE(c+1, r+1, c,   r+1);
                if (!this._solid(c-1, r))   addE(c,   r+1, c,   r);
            }
        }

        const used = new Array(edges.length).fill(false);
        const rawLoops = [];
        for (let i = 0; i < edges.length; i++) {
            if (used[i]) continue;
            const loop = [];
            let cur = i;
            while (cur !== -1 && !used[cur]) {
                used[cur] = true;
                const e = edges[cur];
                loop.push([e[0], e[1]]);
                const cand = startMap.get(e[2] + ',' + e[3]);
                let nx = -1;
                if (cand) for (const j of cand) { if (!used[j]) { nx = j; break; } }
                cur = nx;
            }
            if (loop.length >= 3) rawLoops.push(loop);
        }

        const simplified = rawLoops.map(loop => {
            const n = loop.length, out = [];
            for (let i = 0; i < n; i++) {
                const p = loop[(i - 1 + n) % n], q = loop[i], s = loop[(i + 1) % n];
                const d1x = q[0]-p[0], d1y = q[1]-p[1];
                const d2x = s[0]-q[0], d2y = s[1]-q[1];
                if (d1x * d2y - d1y * d2x !== 0 || d1x*d2x + d1y*d2y <= 0) out.push(q);
            }
            return out.length >= 3 ? out : loop;
        });

        const areaOf = (loop) => {
            let s = 0;
            for (let i = 0; i < loop.length; i++) {
                const a = loop[i], b = loop[(i + 1) % loop.length];
                s += a[0] * b[1] - b[0] * a[1];
            }
            return s / 2;
        };
        const areas = simplified.map(areaOf);
        let outerSign = 1, maxAbs = -1;
        for (const a of areas) { if (Math.abs(a) > maxAbs) { maxAbs = Math.abs(a); outerSign = Math.sign(a) || 1; } }

        this._loops     = simplified.map(loop => this._jag(loop));
        this._loopOuter = areas.map(a => (Math.sign(a) || 1) === outerSign);
    }

    _jag(loop) {
        const cols = this._cols, rows = this._rows, n = loop.length;
        const isBorder = (x, y) => x <= 0 || x >= cols;

        let pts = [];
        for (let i = 0; i < n; i++) {
            const A = loop[i], B = loop[(i + 1) % n];
            const dx = B[0] - A[0], dy = B[1] - A[1];
            const steps = Math.max(1, Math.round(Math.hypot(dx, dy)));
            for (let k = 0; k < steps; k++) {
                const t = k / steps;
                pts.push([A[0] + dx * t, A[1] + dy * t]);
            }
        }
        let m = pts.length;
        if (m < 4) return loop;
        const bflag = pts.map(p => isBorder(p[0], p[1]));

        for (let pass = 0; pass < 5; pass++) {
            const np = pts.slice();
            for (let i = 0; i < m; i++) {
                if (bflag[i]) continue;
                const a = pts[(i - 1 + m) % m], b = pts[i], c = pts[(i + 1) % m];
                np[i] = [a[0]*0.25 + b[0]*0.5 + c[0]*0.25,
                         a[1]*0.25 + b[1]*0.5 + c[1]*0.25];
            }
            pts = np;
        }

        const FACET = 4;
        const AMP   = 1.15;
        const Q     = 0.5;
        const out = [];
        for (let i = 0; i < m; i += FACET) {
            const b = pts[i];

            if (bflag[i]) { out.push([b[0], b[1]]); continue; }
            const a = pts[(i - 1 + m) % m], c = pts[(i + 1) % m];
            const tx = c[0] - a[0], ty = c[1] - a[1];
            const tl = Math.hypot(tx, ty) || 1;
            const nx = ty / tl, ny = -tx / tl;
            const raw = (this._sn(b[0]*0.22, b[1]*0.22, 70) - 0.5) * 2 * AMP;
            const o   = Math.round(raw / Q) * Q;
            out.push([b[0] + nx * o, b[1] + ny * o]);
        }
        return out.length >= 3 ? out : loop;
    }

    _buildFacets() {

        const sf = new Path2D(), so = new Path2D();
        for (let li = 0; li < this._loops.length; li++) {
            const loop = this._loops[li];
            if (loop.length < 3) continue;
            const trace = (p) => {
                p.moveTo(loop[0][0], loop[0][1]);
                for (let q = 1; q < loop.length; q++) p.lineTo(loop[q][0], loop[q][1]);
                p.closePath();
            };
            trace(sf);
            if (this._loopOuter[li]) trace(so);
        }
        this._silFull = sf;
        this._silOuter = so;

        let minc = this._cols, maxc = 0, minr = this._rows, maxr = 0, any = false;
        for (let r = 0; r < this._rows; r++)
            for (let c = 0; c < this._cols; c++)
                if (this._solid(c, r)) {
                    any = true;
                    if (c < minc) minc = c; if (c > maxc) maxc = c;
                    if (r < minr) minr = r; if (r > maxr) maxr = r;
                }
        this._facets = [];
        this._bbox = { minc, maxc, minr, maxr };
        if (!any) return;

        const P = 3.6;
        const gx0 = minc - P, gy0 = minr - P;
        const nx = Math.ceil((maxc - minc) / P) + 3;
        const ny = Math.ceil((maxr - minr) / P) + 3;
        const j = (i, k, s) => this._h(i, k, s) - 0.5;
        const cx = (i, k) => gx0 + i * P + j(i, k, 90) * P * 0.7;
        const cy = (i, k) => gy0 + k * P + j(i, k, 91) * P * 0.7;
        const mid = (ax, ay, bx, by, off) => {
            const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1;
            return [(ax + bx) / 2 - dy / l * off, (ay + by) / 2 + dx / l * off];
        };
        const gray = (x) => { x = Math.max(5, Math.min(82, Math.round(x))); return `rgb(${x},${x},${x})`; };

        for (let k = 0; k < ny; k++) {
            for (let i = 0; i < nx; i++) {
                const ccx = gx0 + (i + 0.5) * P, ccy = gy0 + (k + 0.5) * P;
                const ax = cx(i, k),     ay = cy(i, k);
                const bx = cx(i + 1, k), by = cy(i + 1, k);
                const dcx = cx(i + 1, k + 1), dcy = cy(i + 1, k + 1);
                const ex = cx(i, k + 1), ey = cy(i, k + 1);
                const top = mid(ax, ay, bx, by,   j(i, k, 92) * P * 0.32);
                const rgt = mid(bx, by, dcx, dcy, j(i + 1, k, 93) * P * 0.32);
                const bot = mid(ex, ey, dcx, dcy, j(i, k + 1, 92) * P * 0.32);
                const lft = mid(ax, ay, ex, ey,   j(i, k, 93) * P * 0.32);
                const poly = [[ax, ay], top, [bx, by], rgt, [dcx, dcy], bot, [ex, ey], lft];

                const path = new Path2D();
                path.moveTo(poly[0][0], poly[0][1]);
                for (let p = 1; p < poly.length; p++) path.lineTo(poly[p][0], poly[p][1]);
                path.closePath();

                const broad = (this._sn(ccx * 0.05, ccy * 0.05, 97) - 0.5) * 16;
                const fine  = (this._sn(ccx * 0.17, ccy * 0.17, 95) - 0.5) * 6;
                let v = 40 + broad + fine;
                const hv = this._h(i, k, 96);
                if (hv < 0.10) v -= 8; else if (hv < 0.18) v += 7;
                this._facets.push({ path, fill: gray(v) });
            }
        }
    }

    _drawSingleRock(ctx, cx, cy, scale = 0.4) {

        const Lx = -0.55, Ly = -0.78, Ll = Math.hypot(Lx, Ly), lx = Lx / Ll, ly = Ly / Ll;

        const G = [
            [[-2.20,-1.65],[-1.05,-2.35],[ 0.15,-2.50],[ 1.35,-2.20],[ 2.35,-1.45]],
            [[-3.05,-0.45],[-1.35,-1.00],[ 0.20,-0.85],[ 1.55,-0.70],[ 3.05,-0.20]],
            [[-3.05, 0.95],[-1.20, 0.55],[ 0.30, 0.70],[ 1.65, 0.55],[ 2.70, 1.05]],
            [[-1.95, 1.70],[-0.70, 2.35],[ 0.45, 2.45],[ 1.45, 2.05],[ 2.25, 1.35]],
        ];
        const T = (p) => [cx + p[0] * scale, cy + p[1] * scale];

        const stone = (sv) => {
            sv = sv < 0.05 ? 0.05 : sv > 0.95 ? 0.95 : sv;
            const r = Math.round(24 + sv * 122);
            const g = Math.round(22 + sv * 108);
            const b = Math.round(30 + sv * 98);
            return `rgb(${r},${g},${b})`;
        };

        const tracePoly = (pts) => {
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
            ctx.closePath();
        };

        ctx.save();
        ctx.lineJoin = 'round';
        ctx.lineCap  = 'round';

        const ring = [
            G[0][0], G[0][1], G[0][2], G[0][3], G[0][4],
            G[1][4], G[2][4], G[3][4],
            G[3][3], G[3][2], G[3][1], G[3][0],
            G[2][0], G[1][0],
        ].map(T);

        const shY = cy + 2.55 * scale, shRx = 3.0 * scale, shRy = 0.7 * scale;
        const sg = ctx.createRadialGradient(cx, shY, 0, cx, shY, shRx);
        sg.addColorStop(0, 'rgba(0,0,0,0.40)');
        sg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.save();
        ctx.translate(cx, shY);
        ctx.scale(1, shRy / shRx);
        ctx.beginPath();
        ctx.arc(0, 0, shRx, 0, Math.PI * 2);
        ctx.fillStyle = sg;
        ctx.fill();
        ctx.restore();

        tracePoly(ring);
        ctx.fillStyle = stone(0.36);
        ctx.fill();

        const facets = [];
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 4; c++) {
                const quad = [G[r][c], G[r][c + 1], G[r + 1][c + 1], G[r + 1][c]];

                let mx = 0, my = 0;
                for (const q of quad) { mx += q[0]; my += q[1]; }
                mx /= 4; my /= 4;
                const d = Math.hypot(mx, my) || 1e-4;
                const ndotl = (mx / d) * lx + (my / d) * ly;
                const dome  = Math.min(1, d / 2.6);
                let sv = 0.36 + ndotl * 0.32 * dome;
                sv -= (my / 2.4) * 0.10;
                sv += (this._h(r, c, 5) - 0.5) * 0.05;
                facets.push({ pts: quad.map(T), fill: stone(sv) });
            }
        }
        for (const f of facets) {
            tracePoly(f.pts);
            ctx.fillStyle = f.fill;
            ctx.fill();
        }

        ctx.strokeStyle = 'rgba(0,0,0,0.32)';
        ctx.lineWidth   = 0.05 * scale;
        for (const f of facets) {
            tracePoly(f.pts);
            ctx.stroke();
        }

        ctx.strokeStyle = 'rgba(150,148,162,0.55)';
        ctx.lineWidth   = 0.10 * scale;
        for (let i = 0; i < ring.length; i++) {
            const a = ring[i], b = ring[(i + 1) % ring.length];

            const mxr = (a[0] + b[0]) / 2 - cx, myr = (a[1] + b[1]) / 2 - cy;
            const dr = Math.hypot(mxr, myr) || 1e-4;
            if ((mxr / dr) * lx + (myr / dr) * ly > 0.15) {
                ctx.beginPath();
                ctx.moveTo(a[0], a[1]);
                ctx.lineTo(b[0], b[1]);
                ctx.stroke();
            }
        }

        ctx.strokeStyle = '#000000';
        ctx.lineWidth   = 0.22 * scale;
        ctx.lineJoin    = 'round';
        tracePoly(ring);
        ctx.stroke();

        ctx.restore();
    }

    _drawSecondRock(ctx, cx, cy, scale = 0.4) {
        const Lx = -0.55, Ly = -0.78, Ll = Math.hypot(Lx, Ly), lx = Lx / Ll, ly = Ly / Ll;

        const G = [

            [[-3.70,-1.45],[-2.00,-2.45],[-0.30,-2.70],[ 1.20,-2.40],[ 2.40,-1.60]],
            [[-3.00,-0.20],[-1.45,-1.05],[ 0.10,-0.90],[ 1.50,-0.80],[ 3.10,-0.40]],
            [[-3.35, 1.05],[-1.30, 0.50],[ 0.25, 0.65],[ 1.55, 0.45],[ 2.80, 0.85]],
            [[-3.80, 1.35],[-2.10, 2.20],[ 0.30, 2.50],[ 1.40, 2.10],[ 2.30, 1.50]],
        ];
        const T = (p) => [cx + p[0] * scale, cy + p[1] * scale];

        const stone = (sv) => {
            sv = sv < 0.05 ? 0.05 : sv > 0.95 ? 0.95 : sv;
            const r = Math.round(24 + sv * 122);
            const g = Math.round(22 + sv * 108);
            const b = Math.round(30 + sv * 98);
            return `rgb(${r},${g},${b})`;
        };
        const tracePoly = (pts) => {
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
            ctx.closePath();
        };

        ctx.save();
        ctx.lineJoin = 'round';
        ctx.lineCap  = 'round';

        const ring = [
            G[0][0], G[0][1], G[0][2], G[0][3], G[0][4],
            G[1][4], G[2][4], G[3][4],
            G[3][3], G[3][2], G[3][1], G[3][0],
            G[2][0], G[1][0],
        ].map(T);

        const shY = cy + 2.55 * scale, shRx = 3.0 * scale, shRy = 0.7 * scale;
        const sg = ctx.createRadialGradient(cx, shY, 0, cx, shY, shRx);
        sg.addColorStop(0, 'rgba(0,0,0,0.40)');
        sg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.save();
        ctx.translate(cx, shY);
        ctx.scale(1, shRy / shRx);
        ctx.beginPath();
        ctx.arc(0, 0, shRx, 0, Math.PI * 2);
        ctx.fillStyle = sg;
        ctx.fill();
        ctx.restore();

        tracePoly(ring);
        ctx.fillStyle = stone(0.36);
        ctx.fill();

        const facets = [];
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 4; c++) {
                const quad = [G[r][c], G[r][c + 1], G[r + 1][c + 1], G[r + 1][c]];
                let mx = 0, my = 0;
                for (const q of quad) { mx += q[0]; my += q[1]; }
                mx /= 4; my /= 4;
                const d = Math.hypot(mx, my) || 1e-4;
                const ndotl = (mx / d) * lx + (my / d) * ly;
                const dome  = Math.min(1, d / 2.6);
                let sv = 0.36 + ndotl * 0.32 * dome;
                sv -= (my / 2.4) * 0.10;
                sv += (this._h(r, c, 7) - 0.5) * 0.05;
                facets.push({ pts: quad.map(T), fill: stone(sv) });
            }
        }
        for (const f of facets) {
            tracePoly(f.pts);
            ctx.fillStyle = f.fill;
            ctx.fill();
        }

        ctx.strokeStyle = 'rgba(0,0,0,0.32)';
        ctx.lineWidth   = 0.05 * scale;
        for (const f of facets) { tracePoly(f.pts); ctx.stroke(); }

        ctx.strokeStyle = 'rgba(150,148,162,0.55)';
        ctx.lineWidth   = 0.10 * scale;
        for (let i = 0; i < ring.length; i++) {
            const a = ring[i], b = ring[(i + 1) % ring.length];
            const mxr = (a[0] + b[0]) / 2 - cx, myr = (a[1] + b[1]) / 2 - cy;
            const dr = Math.hypot(mxr, myr) || 1e-4;
            if ((mxr / dr) * lx + (myr / dr) * ly > 0.15) {
                ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
            }
        }

        ctx.strokeStyle = '#000000';
        ctx.lineWidth   = 0.22 * scale;
        ctx.lineJoin    = 'round';
        tracePoly(ring);
        ctx.stroke();

        ctx.restore();
    }

    _drawRockFromGrid(ctx, cx, cy, scale, G, grainSeed) {
        const Lx = -0.55, Ly = -0.78, Ll = Math.hypot(Lx, Ly), lx = Lx / Ll, ly = Ly / Ll;
        const T = (p) => [cx + p[0] * scale, cy + p[1] * scale];
        const stone = (sv) => {
            sv = sv < 0.05 ? 0.05 : sv > 0.95 ? 0.95 : sv;
            return `rgb(${Math.round(24+sv*122)},${Math.round(22+sv*108)},${Math.round(30+sv*98)})`;
        };
        const tracePoly = (pts) => {
            ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
            ctx.closePath();
        };
        ctx.save();
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        const ring = [
            G[0][0], G[0][1], G[0][2], G[0][3], G[0][4],
            G[1][4], G[2][4], G[3][4],
            G[3][3], G[3][2], G[3][1], G[3][0],
            G[2][0], G[1][0],
        ].map(T);
        const shY = cy + 2.55 * scale, shRx = 3.0 * scale, shRy = 0.7 * scale;
        const sg = ctx.createRadialGradient(cx, shY, 0, cx, shY, shRx);
        sg.addColorStop(0, 'rgba(0,0,0,0.40)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.save(); ctx.translate(cx, shY); ctx.scale(1, shRy / shRx);
        ctx.beginPath(); ctx.arc(0, 0, shRx, 0, Math.PI * 2); ctx.fillStyle = sg; ctx.fill();
        ctx.restore();
        tracePoly(ring); ctx.fillStyle = stone(0.36); ctx.fill();
        const facets = [];
        for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
            const quad = [G[r][c], G[r][c+1], G[r+1][c+1], G[r+1][c]];
            let mx = 0, my = 0; for (const q of quad) { mx += q[0]; my += q[1]; } mx /= 4; my /= 4;
            const d = Math.hypot(mx, my) || 1e-4;
            let sv = 0.36 + ((mx/d)*lx+(my/d)*ly) * 0.32 * Math.min(1, d/2.6)
                         - (my/2.4)*0.10 + (this._h(r, c, grainSeed)-0.5)*0.05;
            facets.push({ pts: quad.map(T), fill: stone(sv) });
        }
        for (const f of facets) { tracePoly(f.pts); ctx.fillStyle = f.fill; ctx.fill(); }
        ctx.strokeStyle = 'rgba(0,0,0,0.32)'; ctx.lineWidth = 0.05 * scale;
        for (const f of facets) { tracePoly(f.pts); ctx.stroke(); }
        ctx.strokeStyle = 'rgba(150,148,162,0.55)'; ctx.lineWidth = 0.10 * scale;
        for (let i = 0; i < ring.length; i++) {
            const a = ring[i], b = ring[(i+1) % ring.length];
            const mxr = (a[0]+b[0])/2-cx, myr = (a[1]+b[1])/2-cy, dr = Math.hypot(mxr,myr)||1e-4;
            if ((mxr/dr)*lx+(myr/dr)*ly > 0.15) { ctx.beginPath(); ctx.moveTo(a[0],a[1]); ctx.lineTo(b[0],b[1]); ctx.stroke(); }
        }
        ctx.strokeStyle = '#000000'; ctx.lineWidth = 0.22 * scale; ctx.lineJoin = 'round';
        tracePoly(ring); ctx.stroke();
        ctx.restore();
    }

    _rockOutlinePath(ctx, rcx, rcy, scale, G) {
        const R = G.length, C = G[0].length;
        ctx.moveTo(rcx + G[0][0][0] * scale, rcy + G[0][0][1] * scale);
        for (let c = 1; c < C; c++)
            ctx.lineTo(rcx + G[0][c][0] * scale, rcy + G[0][c][1] * scale);
        for (let r = 1; r < R; r++)
            ctx.lineTo(rcx + G[r][C-1][0] * scale, rcy + G[r][C-1][1] * scale);
        for (let c = C-2; c >= 0; c--)
            ctx.lineTo(rcx + G[R-1][c][0] * scale, rcy + G[R-1][c][1] * scale);
        for (let r = R-2; r > 0; r--)
            ctx.lineTo(rcx + G[r][0][0] * scale, rcy + G[r][0][1] * scale);
        ctx.closePath();
    }

    _buildLineRocks() {
        if (this._lineRocks) return;
        this._lineRocks = [

            { seed:  3, G: [
                [[-2.35,-1.35],[-1.10,-2.05],[ 0.10,-2.20],[ 1.45,-1.95],[ 2.50,-1.30]],
                [[-3.30,-0.30],[-1.45,-0.85],[ 0.20,-0.75],[ 1.65,-0.60],[ 3.30,-0.15]],
                [[-3.25, 0.80],[-1.30, 0.45],[ 0.30, 0.60],[ 1.70, 0.45],[ 2.95, 0.90]],
                [[-2.05, 1.55],[-0.75, 2.15],[ 0.40, 2.30],[ 1.50, 1.90],[ 2.30, 1.25]],
            ]},

            { seed:  7, G: [
                [[-1.90,-1.80],[-0.85,-2.70],[ 0.10,-2.95],[ 1.20,-2.60],[ 2.05,-1.75]],
                [[-2.70,-0.50],[-1.20,-1.15],[ 0.20,-0.95],[ 1.45,-0.80],[ 2.80,-0.25]],
                [[-2.65, 0.95],[-1.10, 0.60],[ 0.25, 0.75],[ 1.55, 0.60],[ 2.55, 1.10]],
                [[-1.75, 1.95],[-0.60, 2.60],[ 0.40, 2.75],[ 1.35, 2.30],[ 2.05, 1.60]],
            ]},

            { seed: 11, G: [
                [[-2.65,-1.55],[-1.45,-2.40],[-0.05,-2.55],[ 1.15,-2.20],[ 2.25,-1.45]],
                [[-3.50,-0.40],[-1.70,-1.00],[ 0.10,-0.80],[ 1.45,-0.65],[ 2.95,-0.25]],
                [[-3.45, 1.00],[-1.55, 0.55],[ 0.20, 0.70],[ 1.55, 0.55],[ 2.65, 1.00]],
                [[-2.45, 1.80],[-1.10, 2.40],[ 0.30, 2.50],[ 1.35, 2.00],[ 2.20, 1.30]],
            ]},

            { seed: 15, G: [
                [[-2.05,-1.45],[-0.90,-2.30],[ 0.25,-2.50],[ 1.50,-2.30],[ 2.60,-1.55]],
                [[-2.85,-0.40],[-1.25,-0.90],[ 0.25,-0.80],[ 1.65,-0.65],[ 3.40,-0.20]],
                [[-2.80, 0.90],[-1.15, 0.55],[ 0.35, 0.70],[ 1.70, 0.55],[ 3.30, 1.00]],
                [[-1.80, 1.60],[-0.55, 2.25],[ 0.55, 2.55],[ 1.65, 2.25],[ 2.70, 1.50]],
            ]},

            { seed: 19, G: [
                [[-2.15,-1.45],[-1.00,-2.20],[ 0.45,-2.55],[ 1.55,-2.35],[ 2.40,-1.55]],
                [[-3.05,-0.45],[-1.35,-0.95],[ 0.25,-0.85],[ 1.60,-0.70],[ 3.10,-0.20]],
                [[-3.00, 0.95],[-1.20, 0.55],[ 0.30, 0.70],[ 1.65, 0.55],[ 2.75, 1.05]],
                [[-1.90, 1.65],[-0.65, 2.30],[ 0.50, 2.45],[ 1.50, 2.10],[ 2.30, 1.40]],
            ]},

            { seed: 23, G: [
                [[-1.80,-1.55],[-0.90,-2.35],[ 0.15,-2.50],[ 1.30,-2.25],[ 2.15,-1.45]],
                [[-2.90,-0.45],[-1.30,-0.95],[ 0.20,-0.85],[ 1.55,-0.70],[ 3.05,-0.20]],
                [[-3.30, 0.95],[-1.50, 0.60],[ 0.30, 0.75],[ 1.70, 0.55],[ 3.20, 1.10]],
                [[-2.55, 1.85],[-1.05, 2.45],[ 0.50, 2.60],[ 1.60, 2.20],[ 2.55, 1.50]],
            ]},

            { seed: 27, G: [
                [[-1.95,-1.50],[-0.90,-2.20],[ 0.10,-2.35],[ 1.25,-2.10],[ 2.15,-1.40]],
                [[-2.75,-0.40],[-1.25,-0.90],[ 0.15,-0.80],[ 1.45,-0.65],[ 2.80,-0.20]],
                [[-2.75, 0.85],[-1.15, 0.50],[ 0.25, 0.65],[ 1.55, 0.50],[ 2.55, 0.95]],
                [[-1.70, 1.65],[-0.60, 2.25],[ 0.40, 2.40],[ 1.35, 2.00],[ 2.10, 1.30]],
            ]},

            { seed: 31, G: [
                [[-2.30,-1.30],[-1.00,-2.45],[ 0.15,-2.65],[ 1.35,-2.40],[ 2.30,-1.30]],
                [[-3.10,-0.40],[-1.40,-1.05],[ 0.20,-0.90],[ 1.55,-0.70],[ 3.10,-0.20]],
                [[-3.05, 0.90],[-1.20, 0.50],[ 0.30, 0.65],[ 1.65, 0.50],[ 2.70, 0.95]],
                [[-2.10, 1.60],[-0.80, 2.20],[ 0.45, 2.30],[ 1.40, 1.90],[ 2.20, 1.25]],
            ]},

            { seed: 37, G: [
                [[-2.10,-1.55],[-0.90,-2.35],[ 0.30,-2.55],[ 1.55,-2.30],[ 2.55,-1.50]],
                [[-3.00,-0.45],[-1.30,-0.95],[ 0.30,-0.85],[ 1.65,-0.70],[ 3.30,-0.20]],
                [[-2.95, 0.95],[-1.20, 0.55],[ 0.35, 0.70],[ 1.70, 0.55],[ 3.20, 1.05]],
                [[-1.90, 1.65],[-0.65, 2.30],[ 0.55, 2.50],[ 1.55, 2.10],[ 2.45, 1.40]],
            ]},
        ];
    }

    draw(ctx, px, py, ratio, gameWidth, gameHeight, screenW, screenH) {
        if (!this.ready) return;

        const originX = screenW / 2 - px - ratio * gameWidth  / 2;
        const originY = screenH / 2 - py - ratio * gameHeight / 2;
        const cellW   = ratio * gameWidth  / this._cols;
        const cellH   = ratio * gameHeight / this._rows;

        ctx.save();
        ctx.translate(originX, originY);
        ctx.scale(cellW, cellH);

        const s   = 0.4;
        const cx  = this._cols / 2, cy = this._rows / 2;
        const d   = 1.8;
        const sq3 = Math.sqrt(3);

        const hex = [
            [ d,       0        ],
            [ d / 2,  -d*sq3/2  ],
            [-d / 2,  -d*sq3/2  ],
            [-d,       0        ],
            [-d / 2,   d*sq3/2  ],
            [ d / 2,   d*sq3/2  ],
        ];
        const pick = [3, 1, 2, 0, 5, 4];

        this._buildLineRocks();

        const centerG = [
            [[-2.20,-1.65],[-1.05,-2.35],[ 0.15,-2.50],[ 1.35,-2.20],[ 2.35,-1.45]],
            [[-3.05,-0.45],[-1.35,-1.00],[ 0.20,-0.85],[ 1.55,-0.70],[ 3.05,-0.20]],
            [[-3.05, 0.95],[-1.20, 0.55],[ 0.30, 0.70],[ 1.65, 0.55],[ 2.70, 1.05]],
            [[-1.95, 1.70],[-0.70, 2.35],[ 0.45, 2.45],[ 1.45, 2.05],[ 2.25, 1.35]],
        ];

        const order = [1, 2, 3, 0, 4, 5];
        const drawList = order.map(i => {
            const rock = this._lineRocks[pick[i]];
            return { rcx: cx + hex[i][0], rcy: cy + hex[i][1], G: rock.G, seed: rock.seed };
        });
        drawList.push({ rcx: cx, rcy: cy, G: centerG, isCenter: true });

        for (let idx = 0; idx < drawList.length; idx++) {
            const item = drawList[idx];
            ctx.save();
            for (let t = idx + 1; t < drawList.length; t++) {
                const top = drawList[t];
                ctx.beginPath();
                ctx.rect(-1000, -1000, 2000, 2000);
                this._rockOutlinePath(ctx, top.rcx, top.rcy, s, top.G);
                ctx.clip('evenodd');
            }
            if (item.isCenter) {
                this._drawSingleRock(ctx, item.rcx, item.rcy, s);
            } else {
                this._drawRockFromGrid(ctx, item.rcx, item.rcy, s, item.G, item.seed);
            }
            ctx.restore();
        }

        ctx.restore();
    }
}

window.terrainRenderer = new TerrainRenderer();
