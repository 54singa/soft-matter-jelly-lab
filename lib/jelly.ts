import * as THREE from 'three/webgpu';
import {
  float,
  materialColor,
  normalWorld,
  cameraPosition,
  positionWorld,
  pmremTexture,
  refract,
} from 'three/tsl';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { SoftBody, SEG, nodeId, restPoint } from './soft-body';

export class JellyWorld {
  host: HTMLElement;
  renderer: THREE.WebGPURenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(34, 1, 0.1, 80);
  body = new SoftBody();
  geometry: THREE.BufferGeometry;
  material: THREE.MeshPhysicalNodeMaterial;
  mesh: THREE.Mesh;
  skinIds: Int32Array;
  skinWeights: Float32Array;
  surfaceRest: Float32Array;
  shadow: THREE.Mesh;
  shadowTexture: THREE.CanvasTexture;
  envTarget: THREE.RenderTarget | null = null;
  pmrem: THREE.PMREMGenerator | null = null;
  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2();
  plane = new THREE.Plane();
  hit = new THREE.Vector3();
  origin = new THREE.Vector3();
  activePointer: number | null = null;
  resizeObserver: ResizeObserver;
  disposed = false;
  frame = 0;
  last = 0;
  grabs = 0;
  peakDeformation = 0;
  peakEnergy = 0;
  peakStrain = 0;
  frameNumber = 0;
  releaseAt = -1;
  releaseTrace: {
    t: number;
    energy: number;
    deformation: number;
    height: number;
  }[] = [];
  accumulator = 0;
  constructor(host: HTMLElement) {
    this.host = host;
    this.renderer = new THREE.WebGPURenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.setClearColor(0xe1e3e2, 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene.background = new THREE.Color(0xe1e3e2);
    this.camera.position.set(4.5, 3.5, 7.8);
    this.camera.lookAt(0, 0.85, 0);
    const box = new THREE.BoxGeometry(2, 2, 2, 30, 30, 30);
    box.deleteAttribute('normal');
    box.deleteAttribute('uv');
    this.geometry = mergeVertices(box);
    box.dispose();
    const attr = this.geometry.getAttribute(
      'position',
    ) as THREE.BufferAttribute;
    this.skinIds = new Int32Array(attr.count * 8);
    this.skinWeights = new Float32Array(attr.count * 8);
    this.surfaceRest = new Float32Array(attr.count * 3);
    for (let i = 0; i < attr.count; i++) {
      const raw = [attr.getX(i), attr.getY(i), attr.getZ(i)];
      const rest = restPoint(...(raw as [number, number, number]));
      this.surfaceRest.set(rest, i * 3);
      attr.setXYZ(i, ...(rest as [number, number, number]));
      const f = raw.map((n) => (n + 1) * 0.5 * SEG),
        base = f.map((n) => Math.min(SEG - 1, Math.max(0, Math.floor(n)))),
        t = f.map((n, j) => n - base[j]);
      let k = 0;
      for (let x = 0; x <= 1; x++)
        for (let y = 0; y <= 1; y++)
          for (let z = 0; z <= 1; z++) {
            this.skinIds[i * 8 + k] = nodeId(
              base[0] + x,
              base[1] + y,
              base[2] + z,
            );
            this.skinWeights[i * 8 + k] =
              (x ? t[0] : 1 - t[0]) *
              (y ? t[1] : 1 - t[1]) *
              (z ? t[2] : 1 - t[2]);
            k++;
          }
    }
    attr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.computeVertexNormals();
    this.material = new THREE.MeshPhysicalNodeMaterial({
      color: 0xffb0e4,
      metalness: 0,
      roughness: 0.045,
      transmission: 1,
      thickness: 1.4,
      ior: 1.46,
      attenuationColor: 0xe12a8f,
      attenuationDistance: 3.5,
      side: THREE.DoubleSide,
      clearcoat: 1,
      clearcoatRoughness: 0.045,
      envMapIntensity: 2.0,
      dispersion: 0.018,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(2000, 2000),
      new THREE.MeshBasicNodeMaterial({ color: 0xe1e3e2, toneMapped: false }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.025;
    this.scene.add(floor);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb4b8ae, 2.4));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(-4, 7, 5);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xd9f5ef, 0.8);
    fill.position.set(4, 2, -4);
    this.scene.add(fill);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createRadialGradient(128, 128, 10, 128, 128, 125);
    g.addColorStop(0, 'rgba(36,38,38,0.75)');
    g.addColorStop(0.35, 'rgba(36,38,38,0.47)');
    g.addColorStop(0.7, 'rgba(36,38,38,0.15)');
    g.addColorStop(1, 'rgba(36,38,38,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    this.shadowTexture = new THREE.CanvasTexture(canvas);
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicNodeMaterial({
        map: this.shadowTexture,
        transparent: true,
        depthWrite: false,
        opacity: 0.8,
      }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.002;
    this.shadow.scale.set(4.8, 4.3, 1);
    this.scene.add(this.shadow);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
  }
  async init() {
    let initialized = false;
    const pendingRenderer = this.renderer;
    const pending = pendingRenderer
      .init()
      .then(() => {
        initialized = true;
        return true;
      })
      .catch(() => false);
    const success = await Promise.race([
      pending,
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2200)),
    ]);
    if (!success && !this.disposed) {
      this.renderer = new THREE.WebGPURenderer({
        antialias: true,
        forceWebGL: true,
      });
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
      this.renderer.setClearColor(0xe1e3e2, 1);
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.05;
      await this.renderer.init();
      void pending.then(() => {
        if (initialized) pendingRenderer.dispose();
      });
    }
    if (this.disposed) return;
    const studio = new THREE.Scene();
    studio.background = new THREE.Color(0x777b79);
    const room = new THREE.Mesh(
      new THREE.BoxGeometry(22, 18, 22),
      new THREE.MeshBasicNodeMaterial({
        color: 0x969b97,
        side: THREE.BackSide,
      }),
    );
    studio.add(room);
    const card = (
      w: number,
      h: number,
      x: number,
      y: number,
      z: number,
      intensity: number,
      color = 0xffffff,
    ) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicNodeMaterial({
          color: new THREE.Color(color).multiplyScalar(intensity),
          side: THREE.DoubleSide,
        }),
      );
      m.position.set(x, y, z);
      m.lookAt(0, 1, 0);
      studio.add(m);
    };
    card(4, 7, -4.2, 3.2, 5.5, 9);
    card(0.6, 6, 4.5, 2.8, 5.5, 7);
    card(7, 3, 0, 7, -2, 5);
    card(1.5, 5, -5, 0.8, 1, 6);
    card(4, 0.55, 0, -2, 5, 5);
    card(4, 5, -5, 2, -4, 0.08);
    card(3, 5, 3.5, 1, -5, 0.16);
    card(2, 2, 0, 1, -6, 2, 0xb2d5bd);
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTarget = this.pmrem.fromScene(studio, 0.025, 0.1, 40);
    this.scene.environment = this.envTarget.texture;
    const view = cameraPosition.sub(positionWorld).normalize();
    this.material.thicknessNode = float(0.18).add(
      normalWorld.dot(view).abs().pow(1.4).mul(1.7),
    );
    // Approximate the refracted studio light in the volume, while the physical
    // transmission pass refracts the floor and the jelly's rear surface.
    const refracted = refract(view.negate(), normalWorld, float(1 / 1.46));
    const transmittedStudio = pmremTexture(
      this.envTarget.texture,
      refracted,
      float(0.04),
    );
    this.material.colorNode = materialColor.rgb.mul(
      transmittedStudio.rgb.mul(0.5).add(0.64).clamp(0.45, 1.7),
    );
    studio.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      }
    });
    if (this.disposed) return;
    this.host.appendChild(this.renderer.domElement);
    this.resize();
    this.renderer.domElement.addEventListener('pointerdown', this.onDown);
    this.renderer.domElement.addEventListener('pointermove', this.onMove);
    this.renderer.domElement.addEventListener('pointerup', this.onUp);
    this.renderer.domElement.addEventListener('pointercancel', this.onUp);
    this.renderer.domElement.addEventListener('lostpointercapture', this.onUp);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('blur', this.onBlur);
    Object.assign(window, {
      __softMatter: {
        metrics: () => ({
          ...this.body.metrics(),
          backend: this.renderer.backend.constructor.name,
          color: this.material.color.getHexString(),
          firmness: this.body.firmness,
          damping: this.body.damping,
        }),
        points: () => {
          const a = this.geometry.getAttribute('position');
          const result = [];
          for (let i = 0; i < a.count; i += 30) {
            const v = new THREE.Vector3()
              .fromBufferAttribute(a, i)
              .project(this.camera);
            result.push({
              x: ((v.x + 1) * this.host.clientWidth) / 2,
              y: ((1 - v.y) * this.host.clientHeight) / 2,
            });
          }
          return result;
        },
      },
    });
    this.last = performance.now();
    this.tick(this.last);
  }
  resize() {
    const w = this.host.clientWidth,
      h = this.host.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    if (w < 760) {
      this.camera.position.set(5.9, 4.9, 10.6);
      this.camera.lookAt(0, 0.95, 0);
      this.camera.setViewOffset(w, h, 0, h * 0.13, w, h);
    } else {
      this.camera.position.set(4.5, 3.5, 7.8);
      this.camera.lookAt(0, 0.95, 0);
      this.camera.clearViewOffset();
    }
    this.camera.updateProjectionMatrix();
  }
  setColor(id: string) {
    const colors: Record<string, [number, number]> = {
      berry: [0xffb0e4, 0xe12a8f],
      mint: [0xb1ffe7, 0x19936c],
      honey: [0xffdfaa, 0xbc771e],
    };
    const [c, a] = colors[id] || colors.berry;
    this.material.color.setHex(c);
    this.material.attenuationColor.setHex(a);
  }
  setFirmness(v: number) {
    this.body.firmness = v;
  }
  setDamping(v: number) {
    this.body.damping = v;
  }
  reset() {
    this.onBlur();
    this.body.reset();
  }
  onKey = (e: KeyboardEvent) => {
    if (
      e.key.toLowerCase() === 'r' &&
      !(e.target instanceof HTMLInputElement) &&
      !e.metaKey &&
      !e.ctrlKey
    )
      this.reset();
  };
  onBlur = () => {
    this.body.grab = null;
    this.activePointer = null;
    this.renderer.domElement.style.cursor = 'grab';
  };
  ray(e: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      (-(e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }
  onDown = (e: PointerEvent) => {
    if (this.activePointer !== null || e.button !== 0) return;
    this.ray(e);
    const intersect = this.raycaster.intersectObject(this.mesh, false)[0];
    if (!intersect?.face) return;
    e.preventDefault();
    this.grabs++;
    this.activePointer = e.pointerId;
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.renderer.domElement.style.cursor = 'grabbing';
    this.origin.copy(intersect.point);
    this.plane.setFromNormalAndCoplanarPoint(
      this.camera.getWorldDirection(new THREE.Vector3()),
      this.origin,
    );
    const pos = this.geometry.getAttribute('position');
    const { a, b, c } = intersect.face;
    const bary = THREE.Triangle.getBarycoord(
      intersect.point,
      new THREE.Vector3().fromBufferAttribute(pos, a),
      new THREE.Vector3().fromBufferAttribute(pos, b),
      new THREE.Vector3().fromBufferAttribute(pos, c),
      new THREE.Vector3(),
    )!;
    const combined = new Map<number, number>();
    [a, b, c].forEach((id, k) => {
      for (let j = 0; j < 8; j++) {
        const node = this.skinIds[id * 8 + j],
          weight = this.skinWeights[id * 8 + j] * bary.getComponent(k);
        combined.set(node, (combined.get(node) || 0) + weight);
      }
    });
    const ids: number[] = [],
      weights: number[] = [];
    combined.forEach((w, id) => {
      if (w > 1e-6) {
        ids.push(id);
        weights.push(w);
      }
    });
    const point = intersect.point.toArray(),
      offset = [...point];
    ids.forEach((id, j) => {
      for (let k = 0; k < 3; k++)
        offset[k] -= this.body.p[id * 3 + k] * weights[j];
    });
    this.body.grab = {
      ids,
      weights,
      offset,
      target: [...point],
      smooth: [...point],
    };
  };
  onMove = (e: PointerEvent) => {
    this.ray(e);
    if (this.body.grab && e.pointerId === this.activePointer) {
      if (this.raycaster.ray.intersectPlane(this.plane, this.hit)) {
        this.hit.sub(this.origin).clampLength(0, 2.8).add(this.origin);
        this.hit.y = Math.max(0.12, this.hit.y);
        this.body.grab.target = this.hit.toArray();
      }
    } else if (this.activePointer === null) {
      this.renderer.domElement.style.cursor = this.raycaster.intersectObject(
        this.mesh,
        false,
      ).length
        ? 'grab'
        : 'default';
    }
  };
  onUp = (e: PointerEvent) => {
    if (e.pointerId !== this.activePointer) return;
    this.activePointer = null;
    this.body.grab = null;
    this.releaseAt = this.body.elapsed;
    this.releaseTrace = [];
    this.renderer.domElement.style.cursor = 'grab';
    if (this.renderer.domElement.hasPointerCapture(e.pointerId))
      this.renderer.domElement.releasePointerCapture(e.pointerId);
  };
  updateSurface() {
    const a = this.geometry.getAttribute('position'),
      p = this.body.p,
      r = this.body.rest;
    for (let i = 0; i < a.count; i++) {
      let x = this.surfaceRest[i * 3],
        y = this.surfaceRest[i * 3 + 1],
        z = this.surfaceRest[i * 3 + 2];
      for (let j = 0; j < 8; j++) {
        const id = this.skinIds[i * 8 + j] * 3,
          w = this.skinWeights[i * 8 + j];
        x += (p[id] - r[id]) * w;
        y += (p[id + 1] - r[id + 1]) * w;
        z += (p[id + 2] - r[id + 2]) * w;
      }
      a.setXYZ(i, x, y, z);
    }
    a.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingSphere();
    let x = 0,
      z = 0,
      y = 0,
      minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (let i = 0; i < p.length; i += 3) {
      x += p[i];
      z += p[i + 2];
      y += p[i + 1];
      minX = Math.min(minX, p[i]);
      maxX = Math.max(maxX, p[i]);
      minZ = Math.min(minZ, p[i + 2]);
      maxZ = Math.max(maxZ, p[i + 2]);
    }
    const height = Math.max(0, y / this.body.count - 0.85);
    this.shadow.position.x = x / this.body.count + 0.06;
    this.shadow.position.z = z / this.body.count + 0.03;
    this.shadow.scale.set(
      (maxX - minX) * 1.55 + height * 0.5,
      (maxZ - minZ) * 1.65 + height * 0.5,
      1,
    );
    (this.shadow.material as THREE.MeshBasicNodeMaterial).opacity =
      0.92 / (1 + height * 0.8);
  }
  tick = (now: number) => {
    if (this.disposed) return;
    this.accumulator += Math.min((now - this.last) / 1000, 0.045);
    this.last = now;
    let steps = 0;
    while (this.accumulator >= 1 / 120 && steps < 6) {
      this.body.step(1 / 120);
      this.accumulator -= 1 / 120;
      steps++;
    }
    this.updateSurface();
    if (++this.frameNumber % 10 === 0) {
      const m = this.body.metrics();
      this.peakDeformation = Math.max(this.peakDeformation, m.deformation);
      this.peakEnergy = Math.max(this.peakEnergy, m.energy);
      this.peakStrain = Math.max(this.peakStrain, m.maxStrain);
      if (this.releaseAt >= 0 && this.body.elapsed - this.releaseAt < 6) {
        this.releaseTrace.push({
          t: this.body.elapsed - this.releaseAt,
          energy: m.energy,
          deformation: m.deformation,
          height: m.height,
        });
        this.host.dataset.rebound = JSON.stringify(this.releaseTrace);
      }
      this.host.dataset.physics = JSON.stringify({
        ...m,
        color: this.material.color.getHexString(),
        grabs: this.grabs,
        peakDeformation: this.peakDeformation,
        peakEnergy: this.peakEnergy,
        peakStrain: this.peakStrain,
        backend: this.renderer.backend.constructor.name,
        firmness: this.body.firmness,
        damping: this.body.damping,
      });
    }
    this.renderer.render(this.scene, this.camera);
    this.frame = requestAnimationFrame(this.tick);
  };
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('blur', this.onBlur);
    this.renderer.domElement.removeEventListener('pointerdown', this.onDown);
    this.renderer.domElement.removeEventListener('pointermove', this.onMove);
    this.renderer.domElement.removeEventListener('pointerup', this.onUp);
    this.renderer.domElement.removeEventListener('pointercancel', this.onUp);
    this.renderer.domElement.removeEventListener(
      'lostpointercapture',
      this.onUp,
    );
    this.renderer.domElement.remove();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m.dispose());
      }
    });
    this.shadowTexture.dispose();
    this.envTarget?.dispose();
    this.pmrem?.dispose();
    this.renderer.dispose();
  }
}
