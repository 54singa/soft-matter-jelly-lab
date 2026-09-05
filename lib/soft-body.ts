// Tetrahedral XPBD: distance constraints provide elasticity, signed tetrahedron
// volumes provide near-incompressibility. The display mesh is independent.
export const SEG = 6;
export const nodeId = (x: number, y: number, z: number) =>
  (x * (SEG + 1) + y) * (SEG + 1) + z;
export function restPoint(x: number, y: number, z: number) {
  // Map the square cage cross-section continuously to a circular pudding.
  // This keeps the same volume cells and precise surface-grab interpolation.
  const diskX = x * Math.sqrt(1 - (z * z) / 2);
  const diskZ = z * Math.sqrt(1 - (x * x) / 2);
  const radial = Math.hypot(diskX, diskZ);
  const extent = Math.max(radial, Math.abs(y));
  // A high-order rounded profile gives a flat top with a rolled rim and base.
  const round =
    extent > 0
      ? extent /
        Math.pow(Math.pow(radial, 16) + Math.pow(Math.abs(y), 16), 1 / 16)
      : 1;
  const height = y * round;
  const radius = 1.48 - (0.48 * (height + 1)) / 2;
  const angle = Math.atan2(diskZ, diskX);
  // Subtle mould flutes run vertically along the tapered sides.
  const fluting =
    1 + 0.027 * Math.cos(10 * angle) * Math.pow(radial * round, 3);
  return [
    diskX * round * radius * fluting,
    height * 0.86 + 0.9,
    diskZ * round * radius * fluting,
  ];
}

type Grab = {
  ids: number[];
  weights: number[];
  offset: number[];
  target: number[];
  smooth: number[];
};
export class SoftBody {
  count = (SEG + 1) ** 3;
  p = new Float64Array(this.count * 3);
  rest = new Float64Array(this.count * 3);
  prev = new Float64Array(this.count * 3);
  vel = new Float64Array(this.count * 3);
  edges: number[] = [];
  lengths: number[] = [];
  tets: number[] = [];
  volumes: number[] = [];
  edgeLambda: Float64Array;
  volumeLambda: Float64Array;
  grab: Grab | null = null;
  firmness = 38;
  damping = 28;
  elapsed = 0;
  constructor() {
    for (let x = 0; x <= SEG; x++)
      for (let y = 0; y <= SEG; y++)
        for (let z = 0; z <= SEG; z++)
          this.rest.set(
            restPoint((x / SEG) * 2 - 1, (y / SEG) * 2 - 1, (z / SEG) * 2 - 1),
            nodeId(x, y, z) * 3,
          );
    this.p.set(this.rest);
    const edgeSet = new Set<string>();
    for (let x = 0; x < SEG; x++)
      for (let y = 0; y < SEG; y++)
        for (let z = 0; z < SEG; z++) {
          const v = [
            nodeId(x, y, z),
            nodeId(x + 1, y, z),
            nodeId(x, y + 1, z),
            nodeId(x + 1, y + 1, z),
            nodeId(x, y, z + 1),
            nodeId(x + 1, y, z + 1),
            nodeId(x, y + 1, z + 1),
            nodeId(x + 1, y + 1, z + 1),
          ];
          for (const q of [
            [0, 1, 3, 7],
            [0, 3, 2, 7],
            [0, 2, 6, 7],
            [0, 6, 4, 7],
            [0, 4, 5, 7],
            [0, 5, 1, 7],
          ]) {
            let ids = q.map((i) => v[i]);
            let vol = this.volume(ids);
            if (vol < 0) {
              [ids[1], ids[2]] = [ids[2], ids[1]];
              vol = -vol;
            }
            this.tets.push(...ids.map((i) => i * 3));
            this.volumes.push(vol);
            for (let a = 0; a < 4; a++)
              for (let b = a + 1; b < 4; b++)
                edgeSet.add([ids[a], ids[b]].sort((i, j) => i - j).join(','));
          }
        }
    for (const key of edgeSet) {
      const [i, j] = key.split(',').map((n) => Number(n) * 3);
      this.edges.push(i, j);
      this.lengths.push(
        Math.hypot(
          this.p[i] - this.p[j],
          this.p[i + 1] - this.p[j + 1],
          this.p[i + 2] - this.p[j + 2],
        ),
      );
    }
    this.edgeLambda = new Float64Array(this.lengths.length);
    this.volumeLambda = new Float64Array(this.volumes.length);
  }
  volume(ids: number[]) {
    const [a, b, c, d] = ids.map((i) => i * 3),
      p = this.p;
    const bx = p[b] - p[a],
      by = p[b + 1] - p[a + 1],
      bz = p[b + 2] - p[a + 2],
      cx = p[c] - p[a],
      cy = p[c + 1] - p[a + 1],
      cz = p[c + 2] - p[a + 2],
      dx = p[d] - p[a],
      dy = p[d + 1] - p[a + 1],
      dz = p[d + 2] - p[a + 2];
    return (
      (bx * (cy * dz - cz * dy) +
        by * (cz * dx - cx * dz) +
        bz * (cx * dy - cy * dx)) /
      6
    );
  }
  reset() {
    this.p.set(this.rest);
    this.vel.fill(0);
    this.grab = null;
    this.elapsed = 0;
  }
  step(h: number) {
    this.elapsed += h;
    const p = this.p,
      v = this.vel;
    this.prev.set(p);
    this.edgeLambda.fill(0);
    this.volumeLambda.fill(0);
    let cx = 0,
      cz = 0;
    for (let i = 0; i < p.length; i += 3) {
      cx += p[i];
      cz += p[i + 2];
    }
    cx /= this.count;
    cz /= this.count;
    const damp = Math.exp(-(0.45 + this.damping * 0.062) * h);
    for (let i = 0; i < p.length; i += 3) {
      v[i] = (v[i] - cx * 3.0 * h) * damp;
      v[i + 1] = (v[i + 1] - 5.2 * h) * damp;
      v[i + 2] = (v[i + 2] - cz * 3.0 * h) * damp;
      for (let k = 0; k < 3; k++)
        p[i + k] += Math.max(-18, Math.min(18, v[i + k])) * h;
    }
    if (this.grab) {
      const g = this.grab,
        dist = Math.hypot(
          g.target[0] - g.smooth[0],
          g.target[1] - g.smooth[1],
          g.target[2] - g.smooth[2],
        );
      const gain = Math.min(
        1 - Math.exp(-24 * h),
        (6 * h) / Math.max(dist, 1e-8),
      );
      for (let k = 0; k < 3; k++)
        g.smooth[k] += (g.target[k] - g.smooth[k]) * gain;
    }
    const alpha = (0.004 * Math.pow(0.012, this.firmness / 100)) / (h * h);
    const va = 1e-9 / (h * h);
    for (let pass = 0; pass < 5; pass++) {
      for (let e = 0; e < this.lengths.length; e++) {
        const i = this.edges[e * 2],
          j = this.edges[e * 2 + 1],
          dx = p[i] - p[j],
          dy = p[i + 1] - p[j + 1],
          dz = p[i + 2] - p[j + 2],
          len = Math.hypot(dx, dy, dz);
        if (len < 1e-8) continue;
        const dl =
          (-(len - this.lengths[e]) - alpha * this.edgeLambda[e]) / (2 + alpha);
        this.edgeLambda[e] += dl;
        const s = dl / len;
        p[i] += dx * s;
        p[i + 1] += dy * s;
        p[i + 2] += dz * s;
        p[j] -= dx * s;
        p[j + 1] -= dy * s;
        p[j + 2] -= dz * s;
      }
      for (let t = 0; t < this.volumes.length; t++) {
        const a = this.tets[t * 4],
          b = this.tets[t * 4 + 1],
          c = this.tets[t * 4 + 2],
          d = this.tets[t * 4 + 3];
        const bx = p[b] - p[a],
          by = p[b + 1] - p[a + 1],
          bz = p[b + 2] - p[a + 2],
          cx = p[c] - p[a],
          cy = p[c + 1] - p[a + 1],
          cz = p[c + 2] - p[a + 2],
          dx = p[d] - p[a],
          dy = p[d + 1] - p[a + 1],
          dz = p[d + 2] - p[a + 2];
        const gbx = (cy * dz - cz * dy) / 6,
          gby = (cz * dx - cx * dz) / 6,
          gbz = (cx * dy - cy * dx) / 6;
        const gcx = (dy * bz - dz * by) / 6,
          gcy = (dz * bx - dx * bz) / 6,
          gcz = (dx * by - dy * bx) / 6;
        const gdx = (by * cz - bz * cy) / 6,
          gdy = (bz * cx - bx * cz) / 6,
          gdz = (bx * cy - by * cx) / 6;
        const gax = -gbx - gcx - gdx,
          gay = -gby - gcy - gdy,
          gaz = -gbz - gcz - gdz;
        const vol = bx * gbx + by * gby + bz * gbz;
        const denom =
          gax * gax +
          gay * gay +
          gaz * gaz +
          gbx * gbx +
          gby * gby +
          gbz * gbz +
          gcx * gcx +
          gcy * gcy +
          gcz * gcz +
          gdx * gdx +
          gdy * gdy +
          gdz * gdz;
        const dl =
          (-(vol - this.volumes[t]) - va * this.volumeLambda[t]) / (denom + va);
        this.volumeLambda[t] += dl;
        p[a] += dl * gax;
        p[a + 1] += dl * gay;
        p[a + 2] += dl * gaz;
        p[b] += dl * gbx;
        p[b + 1] += dl * gby;
        p[b + 2] += dl * gbz;
        p[c] += dl * gcx;
        p[c + 1] += dl * gcy;
        p[c + 2] += dl * gcz;
        p[d] += dl * gdx;
        p[d + 1] += dl * gdy;
        p[d + 2] += dl * gdz;
      }
      if (this.grab) {
        const g = this.grab;
        let den = 0.000003 / (h * h);
        const q = [...g.offset];
        for (let j = 0; j < g.ids.length; j++) {
          den += g.weights[j] ** 2;
          for (let k = 0; k < 3; k++)
            q[k] += p[g.ids[j] * 3 + k] * g.weights[j];
        }
        for (let j = 0; j < g.ids.length; j++)
          for (let k = 0; k < 3; k++)
            p[g.ids[j] * 3 + k] += ((g.smooth[k] - q[k]) * g.weights[j]) / den;
      }
      for (let i = 0; i < p.length; i += 3)
        if (p[i + 1] < 0.035) {
          p[i + 1] = 0.035;
          p[i] += (this.prev[i] - p[i]) * 0.16;
          p[i + 2] += (this.prev[i + 2] - p[i + 2]) * 0.16;
        }
    }
    for (let i = 0; i < p.length; i++) v[i] = (p[i] - this.prev[i]) / h;
    // A numerical guard also recovers from tab-resume and graphics pauses.
    if (!Number.isFinite(p[0]) || Math.abs(p[0]) > 30) this.reset();
  }
  metrics() {
    let energy = 0,
      def = 0,
      minY = Infinity,
      maxY = -Infinity;
    for (let i = 0; i < this.p.length; i++) {
      energy += this.vel[i] ** 2;
      def += (this.p[i] - this.rest[i]) ** 2;
      if (i % 3 === 1) {
        minY = Math.min(minY, this.p[i]);
        maxY = Math.max(maxY, this.p[i]);
      }
    }
    let maxStrain = 0,
      rms = 0;
    for (let e = 0; e < this.lengths.length; e++) {
      const i = this.edges[e * 2],
        j = this.edges[e * 2 + 1];
      const strain =
        Math.hypot(
          this.p[i] - this.p[j],
          this.p[i + 1] - this.p[j + 1],
          this.p[i + 2] - this.p[j + 2],
        ) /
          this.lengths[e] -
        1;
      maxStrain = Math.max(maxStrain, Math.abs(strain));
      rms += strain * strain;
    }
    return {
      maxStrain,
      rmsStrain: Math.sqrt(rms / this.lengths.length),
      grabbing: !!this.grab,
      energy: energy / this.count,
      deformation: Math.sqrt(def / this.count),
      height: maxY - minY,
      finite: this.p.every(Number.isFinite),
    };
  }
}
