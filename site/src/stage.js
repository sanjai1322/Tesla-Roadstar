import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { createThrust } from './thrust.js';

const BG = 0x050506;
const isMobileGlobal = typeof matchMedia !== 'undefined' && matchMedia('(max-width: 768px)').matches;
const FPS = 24;
const LAST_FRAME = 288;

/* ---------- helpers ---------- */
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
// widen vertical fov on narrow screens so the car keeps its horizontal framing
const fitFov = (fov, aspect, ref = 1.5) =>
  aspect >= ref ? fov : Math.min(72, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov) / 2) * ref / aspect)));

function radialTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)', size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.45, inner.replace(/[\d.]+\)$/, '0.35)'));
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* Studio environment: black room with softbox strips, for crisp paint reflections */
function studioEnvironment(renderer, warm = false) {
  const s = new THREE.Scene();
  s.background = new THREE.Color(0x000000);
  const geo = new THREE.PlaneGeometry(1, 1);
  const add = (w, h, pos, intensity, color = 0xffffff) => {
    const m = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide })
    );
    m.scale.set(w, h, 1);
    m.position.set(...pos);
    m.lookAt(0, 0.5, 0);
    s.add(m);
  };
  add(14, 1.6, [0, 7, 0], 5.0);            // long overhead strip
  add(14, 0.5, [0, 6.5, 2.4], 3.0);         // second overhead line
  add(14, 0.5, [0, 6.5, -2.4], 3.0);
  add(12, 1.2, [0, 2.2, 8], 1.8);           // side strips
  add(12, 1.2, [0, 2.2, -8], 1.8);
  add(1.6, 5, [-9, 2.5, 0], 2.4);           // front panel
  add(1.6, 5, [9, 2.5, 0], 1.6, warm ? 0xffc890 : 0xffe2c0); // warm rear edge
  add(30, 30, [0, -4, 0], 0.06);           // faint floor bounce
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(s, 0.035).texture;
  pm.dispose();
  return tex;
}

/* Upgrade the exported Blender materials for real-time studio look */
function tuneMaterials(root, { emissiveBoost = 1 } = {}) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m) => {
      const n = (m.name || '').toLowerCase();
      if (n.includes('paint')) {
        m.color.set(0xc9ced4);
        m.metalness = 0.55;
        m.roughness = 0.26;
        m.clearcoat = 1;
        m.clearcoatRoughness = 0.035;
        m.envMapIntensity = 1.35;
      } else if (n.includes('glazing') && !n.includes('seal')) {
        m.transmission = 0;
        m.transparent = true;
        m.opacity = 0.86;
        m.color.set(0x2a1c12);
        m.metalness = 0.65;
        m.roughness = 0.04;
        m.clearcoat = 1;
        m.envMapIntensity = 1.6;
        m.depthWrite = false;
      } else if (n.includes('lamp lens')) {
        m.transmission = 0;
        m.transparent = true;
        m.opacity = 0.55;
        m.depthWrite = false;
      } else if (n.includes('aluminium')) {
        m.envMapIntensity = 1.5;
        m.roughness = 0.18;
      } else if (n.includes('titanium')) {
        m.envMapIntensity = 1.4;
      } else if (n.includes('red optical')) {
        m.emissiveIntensity = 7 * emissiveBoost;
        m.toneMapped = true;
      } else if (n.includes('white optical')) {
        m.emissiveIntensity = 5 * emissiveBoost;
      } else if (n.includes('amber')) {
        m.emissiveIntensity = 4 * emissiveBoost;
      } else if (n.includes('cabin red')) {
        m.emissiveIntensity = 3 * emissiveBoost;
      } else if (n.includes('tire')) {
        m.envMapIntensity = 0.6;
      }
      m.needsUpdate = true;
    });
  });
}

function makeFloor(scene, { pool = 0.55, poolScale = [11, 6.5] } = {}) {
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshStandardMaterial({ color: 0x060607, roughness: 0.6, metalness: 0.0, envMapIntensity: 0.04 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const spot = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: radialTexture('rgba(255,250,240,1)'), transparent: true, opacity: pool, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  spot.rotation.x = -Math.PI / 2;
  spot.scale.set(poolScale[0], poolScale[1], 1);
  spot.position.y = 0.002;
  scene.add(spot);
  return { floor, spot };
}

function keyLight(scene, intensity = 60) {
  const l = new THREE.SpotLight(0xfff6ea, intensity, 0, 0.5, 0.85, 1.6);
  l.position.set(0.5, 7.5, 0.6);
  l.target.position.set(0, 0, 0);
  l.castShadow = true;
  l.shadow.mapSize.set(isMobileGlobal ? 512 : 1024, isMobileGlobal ? 512 : 1024);
  l.shadow.bias = -0.0002;
  l.shadow.normalBias = 0.02;
  l.shadow.radius = 6;
  l.shadow.camera.near = 2;
  l.shadow.camera.far = 14;
  scene.add(l, l.target);
  return l;
}

/* X-ray fresnel shader with clipping support */
function xrayMaterial(color = new THREE.Color(0x9db8ff)) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      #include <clipping_planes_pars_vertex>
      varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){
        vec4 mvPosition = modelViewMatrix * vec4(position,1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mvPosition.xyz);
        vW = (modelMatrix * vec4(position,1.0)).xyz;
        gl_Position = projectionMatrix * mvPosition;
        #include <clipping_planes_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <clipping_planes_pars_fragment>
      uniform vec3 uColor; uniform float uTime;
      varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){
        #include <clipping_planes_fragment>
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
        float lines = smoothstep(0.92, 1.0, abs(sin(vW.y * 60.0))) * 0.12;
        vec3 c = uColor * (0.05 + f * 1.25 + lines);
        gl_FragColor = vec4(c, 0.08 + f * 0.85);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    clipping: true,
  });
}

/* ================================================================== */
export function createStage(canvas) {
  const isMobile = matchMedia('(max-width: 768px)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isMobile, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.25 : 1.5));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.localClippingEnabled = true;

  const draco = new DRACOLoader().setDecoderPath('/draco/');
  const loader = new GLTFLoader().setDRACOLoader(draco);

  const envCool = studioEnvironment(renderer, false);
  const envWarm = studioEnvironment(renderer, true);

  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.4, 0.45, 2.2);
  const bloomSetSize = bloom.setSize.bind(bloom);
  bloom.setSize = (w, h) => bloomSetSize(Math.round(w / 2), Math.round(h / 2));
  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const scenes = {};
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  addEventListener('pointermove', (e) => {
    pointer.x = (e.clientX / innerWidth) * 2 - 1;
    pointer.y = (e.clientY / innerHeight) * 2 - 1;
  });

  /* ---------------- HERO (animated GLB) ---------------- */
  function buildHero(gltf) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BG);
    scene.fog = new THREE.Fog(BG, 9, 24);
    scene.environment = envWarm;
    const cam = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.05, 100);
    makeFloor(scene, { pool: 0.22 });
    keyLight(scene, 55);

    const car = gltf.scene;
    tuneMaterials(car);
    scene.add(car);

    let master = null;
    car.traverse((o) => { if (!master && /CTRL/i.test(o.name)) master = o; });
    master = master || car;
    const tmpV = new THREE.Vector3();
    const mixer = new THREE.AnimationMixer(car);
    gltf.animations.forEach((clip) => {
      const a = mixer.clipAction(clip);
      a.play();
    });
    mixer.setTime(0);

    const thrustFx = createThrust(scene, master, { mobile: isMobile });

    // camera path keyed to scroll progress
    const keys = [
      { p: 0.0, pos: [-8.4, 1.0, 6.0], tgt: [0.1, 1.15, 0], fov: 26 },
      { p: 0.13, pos: [-6.4, 1.1, 5.0], tgt: [0, 0.75, 0], fov: 28 },
      { p: 0.3, pos: [-2.4, 2.4, 5.6], tgt: [-0.4, 0.6, 0], fov: 30 },
      { p: 0.42, pos: [0.6, 3.2, 4.2], tgt: [-0.5, 0.6, 0], fov: 32 },
      { p: 0.56, pos: [5.4, 1.5, 4.0], tgt: [0.6, 0.6, 0], fov: 30 },
      { p: 0.68, pos: [6.0, 1.2, 1.8], tgt: [0.8, 0.7, 0], fov: 30 },
      { p: 0.8, pos: [8.2, 1.25, -1.6], tgt: [1.0, 0.75, 0], fov: 30 },
      { p: 0.9, pos: [8.6, 1.05, 0.6], tgt: [1.0, 0.8, 0], fov: 30 },
      { p: 1.0, pos: [6.4, 1.5, 5.2], tgt: [0.4, 0.7, 0], fov: 28 },
    ];
    const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3();
    const target = new THREE.Vector3();

    let progress = 0, smoothP = 0, intro = 0;
    const state = {
      scene, cam,
      setProgress(p) { progress = p; },
      intro(v) { intro = v; },
      frame() { return 1 + Math.round(clamp01(smoothP / 0.95) * (274 - 1)); },
      update(dt, time) {
        smoothP = lerp(smoothP, progress, 1 - Math.pow(0.00002, dt));
        const p = smoothP;
        // animation scrub (frames 1..274 across 0..0.95)
        const f = 1 + clamp01(p / 0.95) * 273;
        mixer.setTime((f - 1) / FPS);

        // camera
        let i = 0;
        while (i < keys.length - 2 && p > keys[i + 1].p) i++;
        const a = keys[i], b = keys[i + 1];
        const t = smooth(clamp01((p - a.p) / (b.p - a.p)));
        v1.fromArray(a.pos); v2.fromArray(b.pos);
        t1.fromArray(a.tgt); t2.fromArray(b.tgt);
        cam.position.lerpVectors(v1, v2, t);
        target.lerpVectors(t1, t2, t);
        cam.fov = fitFov(lerp(a.fov, b.fov, t), cam.aspect);
        // intro dolly
        const k = 1 - smooth(intro);
        cam.position.multiplyScalar(1 + k * 0.35);
        cam.position.y += k * 0.4;
        // pointer parallax
        pointer.sx = lerp(pointer.sx, pointer.x, 0.04);
        pointer.sy = lerp(pointer.sy, pointer.y, 0.04);
        cam.position.x += pointer.sx * 0.25;
        cam.position.y += -pointer.sy * 0.12;
        cam.lookAt(target);
        cam.updateProjectionMatrix();

        // thrust phase (frames 198..274): ramps with the lift, cuts as the car settles
        const thrust = clamp01((f - 198) / 14) * (1 - clamp01((f - 258) / 12));
        thrustFx.update(dt, time, thrust);
      },
    };
    return state;
  }

  /* ---------------- XRAY (rigged GLB) ---------------- */
  function buildXray(gltf) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x030406);
    scene.fog = new THREE.Fog(0x030406, 8, 20);
    scene.environment = envCool;
    const cam = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.05, 100);

    const grid = new THREE.GridHelper(40, 80, 0x1c2540, 0x10141f);
    grid.material.transparent = true;
    grid.material.opacity = 0.55;
    scene.add(grid);
    keyLight(scene, 40);

    const solid = gltf.scene;
    tuneMaterials(solid);
    const xray = solid.clone(true);
    const planeSolid = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
    const planeX = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
    solid.traverse((o) => {
      if (!o.isMesh) return;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      ms.forEach((m) => { m.clippingPlanes = [planeSolid]; m.clipShadows = true; });
    });
    const xm = xrayMaterial();
    xm.clippingPlanes = [planeX];
    xray.traverse((o) => { if (o.isMesh) { o.material = xm; o.castShadow = false; o.receiveShadow = false; } });
    scene.add(solid, xray);

    // scan blade
    const bladeMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0x9db8ff) } },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
      fragmentShader: `uniform vec3 uColor; varying vec2 vUv; void main(){ float e = smoothstep(0.0,0.25,vUv.y)*smoothstep(1.0,0.6,vUv.y); float side = smoothstep(0.0,0.15,vUv.x)*smoothstep(1.0,0.85,vUv.x); gl_FragColor = vec4(uColor*1.4, 0.16*e*side);} `,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const blade = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.0), bladeMat);
    blade.rotation.y = Math.PI / 2;
    blade.position.y = 0.8;
    const edge = new THREE.Mesh(new THREE.PlaneGeometry(0.012, 2.0), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9db8ff).multiplyScalar(4), transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
    edge.rotation.y = Math.PI / 2;
    edge.position.y = 0.8;
    const floorLine = new THREE.Mesh(new THREE.PlaneGeometry(0.02, 3.4), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9db8ff).multiplyScalar(3) }));
    floorLine.rotation.x = -Math.PI / 2;
    floorLine.position.y = 0.003;
    scene.add(blade, edge, floorLine);

    const X0 = -2.45, X1 = 2.45;
    let progress = 0, sp = 0;
    return {
      scene, cam,
      setProgress(p) { progress = p; },
      scan() { return clamp01((sp - 0.08) / 0.84); },
      update(dt, time) {
        sp = lerp(sp, progress, 1 - Math.pow(0.002, dt));
        const s = clamp01((sp - 0.08) / 0.84);
        const x = lerp(X0, X1, s);
        planeSolid.constant = -x;
        planeX.constant = x;
        blade.position.x = edge.position.x = floorLine.position.x = x;
        const vis = s > 0.001 && s < 0.999 ? 1 : 0;
        blade.visible = edge.visible = floorLine.visible = !!vis;
        // orbit: front three quarter to rear three quarter
        const ang = lerp(-2.35, -0.75, smooth(sp));
        const r = lerp(7.4, 6.6, sp);
        cam.position.set(Math.cos(ang) * r * 0.95 + pointer.sx * 0.2, lerp(2.4, 1.6, sp), -Math.sin(ang) * r);
        cam.fov = fitFov(30, cam.aspect);
        cam.lookAt(x * 0.25, 0.55, 0);
        cam.updateProjectionMatrix();
        xm.uniforms.uTime.value = time;
      },
    };
  }

  /* ---------------- INSPECT (studio GLB + Blender cameras) ---------------- */
  function buildInspect(gltf, dom) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0b);
    scene.fog = new THREE.Fog(0x0a0a0b, 10, 26);
    scene.environment = envWarm;
    const cam = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.01, 100);
    makeFloor(scene, { pool: 0.3, poolScale: [12, 7] });
    keyLight(scene, 80);
    const car = gltf.scene;
    car.updateMatrixWorld(true);
    tuneMaterials(car);
    scene.add(car);

    // read the Blender cameras
    const views = [];
    const center = new THREE.Vector3(0, 0.55, 0);
    const wanted = [
      ['front three quarter', 'Front 3/4'],
      ['front optical details', 'Front optics'],
      ['wheel detail', 'Wheel'],
      ['doors full opening', 'Doors'],
      ['open cockpit details', 'Cockpit'],
      ['yoke detail', 'Yoke'],
      ['interior reference inspection', 'Interior'],
      ['thrust inspection', 'Thrusters'],
      ['rear three quarter', 'Rear 3/4'],
      ['continuous orbital', 'Orbit'],
    ];
    const cams = [];
    gltf.scene.traverse((o) => { if (o.isCamera) cams.push(o); });
    wanted.forEach(([key, label]) => {
      const norm = (n) => (n || '').toLowerCase().replace(/_/g, ' ');
      const c = cams.find((cc) => norm(cc.name).includes(key) || norm(cc.parent?.name).includes(key));
      if (!c || !c.isPerspectiveCamera) return;
      const pos = new THREE.Vector3(), q = new THREE.Quaternion();
      c.getWorldPosition(pos);
      c.getWorldQuaternion(q);
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
      const d = Math.max(0.6, center.clone().sub(pos).dot(fwd));
      const hf = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(c.fov) / 2) * 1.6);
      views.push({ label, pos, tgt: pos.clone().add(fwd.multiplyScalar(d)), fov: hf });
    });

    const controls = new OrbitControls(cam, dom);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.minPolarAngle = 0.2;
    controls.maxPolarAngle = Math.PI / 2 - 0.02;
    controls.rotateSpeed = 0.6;

    // fov values here are horizontal (radians); vertical is derived from the live aspect
    const vfov = (hf) => {
      const v = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hf / 2) / cam.aspect));
      return Math.min(v, 75);
    };
    let curH = 0.9;
    const from = { pos: new THREE.Vector3(), tgt: new THREE.Vector3(), fov: 0.9 };
    const to = { pos: new THREE.Vector3(), tgt: new THREE.Vector3(), fov: 0.9 };
    let tween = 1, autoSpin = true, idle = 0;
    controls.addEventListener('start', () => { tween = 1; autoSpin = false; idle = 0; });

    function go(i) {
      const v = views[i];
      if (!v) return;
      from.pos.copy(cam.position); from.tgt.copy(controls.target); from.fov = curH;
      to.pos.copy(v.pos); to.tgt.copy(v.tgt); to.fov = v.fov;
      tween = 0;
      autoSpin = false;
      idle = 0;
    }
    // start
    const first = views[0] || { pos: new THREE.Vector3(-6, 1.4, 5), tgt: center, fov: 0.75 };
    cam.position.copy(first.pos);
    controls.target.copy(first.tgt);
    curH = first.fov;

    return {
      scene, cam, views, go, controls,
      update(dt, time, rawDt) {
        if (tween < 1) {
          tween = Math.min(1, tween + rawDt / 1.6);
          const e = 1 - Math.pow(1 - tween, 4);
          // arc the move a little above the car so it never clips through
          cam.position.lerpVectors(from.pos, to.pos, e);
          cam.position.y += Math.sin(e * Math.PI) * 0.6 * Math.min(1, from.pos.distanceTo(to.pos) / 4);
          controls.target.lerpVectors(from.tgt, to.tgt, e);
          curH = lerp(from.fov, to.fov, e);
        } else {
          idle += dt;
          if (autoSpin || idle > 8) {
            const off = cam.position.clone().sub(controls.target);
            off.applyAxisAngle(new THREE.Vector3(0, 1, 0), dt * 0.08);
            cam.position.copy(controls.target).add(off);
          }
        }
        cam.fov = vfov(curH);
        cam.updateProjectionMatrix();
        controls.update();
      },
    };
  }

  /* ---------------- loading ---------------- */
  function load(url, onProgress) {
    return new Promise((res, rej) => loader.load(url, res, (e) => onProgress && e.total && onProgress(e.loaded / e.total), rej));
  }

  let active = null;
  function setActive(name) {
    active = name && scenes[name] ? name : null;
    canvas.classList.toggle('is-on', !!active);
  }

  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    Object.values(scenes).forEach((s) => { s.cam.aspect = w / h; s.cam.updateProjectionMatrix(); });
  }
  addEventListener('resize', resize);

  const clock = new THREE.Clock();
  function tick() {
    const raw = clock.getDelta();
    const dt = Math.min(raw, 0.05);
    const time = clock.elapsedTime;
    if (active) {
      const s = scenes[active];
      s.update(dt, time, Math.min(raw, 0.3));
      renderPass.scene = s.scene;
      renderPass.camera = s.cam;
      bloom.strength = active === 'xray' ? 0.6 : 0.4;
      composer.render(dt);
    }
    requestAnimationFrame(tick);
  }

  return {
    renderer,
    scenes,
    setActive,
    async loadHero(onProgress) {
      const g = await load('/models/roadster_animated.glb', onProgress);
      scenes.hero = buildHero(g);
      resize();
      // compile shaders up front to avoid a hitch on first scroll
      renderer.compile(scenes.hero.scene, scenes.hero.cam);
      return scenes.hero;
    },
    async loadXray() {
      const g = await load('/models/roadster_rigged.glb');
      scenes.xray = buildXray(g);
      resize();
      return scenes.xray;
    },
    async loadInspect(dom) {
      const g = await load('/models/roadster_studio.glb');
      scenes.inspect = buildInspect(g, dom);
      resize();
      return scenes.inspect;
    },
    start() { tick(); },
  };
}
