import * as THREE from 'three';

/*
  Cold gas thrust, modelled on the reveal film and studio stills:
  two tight jets fire straight down from under the diffuser, hit the floor,
  then roll outward as slow, dense, rising vapor that lingers after cut-off.
  Instanced camera-facing quads, simulated on the CPU (cheap at this count).
*/

function smokeTexture(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const r = size / 2;
  // billowy puff from overlapping soft lobes, lit from above
  for (let i = 0; i < 22; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.random() * r * 0.42;
    const x = r + Math.cos(a) * d;
    const y = r + Math.sin(a) * d;
    const rad = r * (0.32 + Math.random() * 0.3);
    const lit = 0.75 + 0.25 * (1 - (y / size));
    const grd = g.createRadialGradient(x, y - rad * 0.25, 0, x, y, rad);
    grd.addColorStop(0, `rgba(${255 * lit | 0},${255 * lit | 0},${255 * lit | 0},0.34)`);
    grd.addColorStop(0.6, `rgba(${220 * lit | 0},${222 * lit | 0},${228 * lit | 0},0.14)`);
    grd.addColorStop(1, 'rgba(200,200,205,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  }
  // fade the square edge out
  g.globalCompositeOperation = 'destination-in';
  const m = g.createRadialGradient(r, r, r * 0.35, r, r, r);
  m.addColorStop(0, 'rgba(0,0,0,1)');
  m.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = m;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createThrust(scene, anchor, { mobile = false } = {}) {
  const MAX = mobile ? 650 : 1400;
  const nozzlesLocal = [new THREE.Vector3(2.12, 0.3, 0.42), new THREE.Vector3(2.12, 0.3, -0.42)];
  const nozzles = nozzlesLocal.map(() => new THREE.Vector3());

  /* ---------- particles ---------- */
  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.getAttribute('position'));
  geo.setAttribute('uv', quad.getAttribute('uv'));
  const aPos = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const aSize = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1).setUsage(THREE.DynamicDrawUsage);
  const aAlpha = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1).setUsage(THREE.DynamicDrawUsage);
  const aRot = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1).setUsage(THREE.DynamicDrawUsage);
  const aHeat = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iPos', aPos);
  geo.setAttribute('iSize', aSize);
  geo.setAttribute('iAlpha', aAlpha);
  geo.setAttribute('iRot', aRot);
  geo.setAttribute('iHeat', aHeat);
  geo.instanceCount = 0;

  const mat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: smokeTexture() } },
    vertexShader: /* glsl */ `
      attribute vec3 iPos; attribute float iSize; attribute float iAlpha; attribute float iRot; attribute float iHeat;
      varying vec2 vUv; varying float vAlpha; varying float vHeat; varying float vH;
      void main(){
        vec4 mv = viewMatrix * vec4(iPos, 1.0);
        float c = cos(iRot), s = sin(iRot);
        vec2 p = mat2(c, -s, s, c) * position.xy;
        mv.xy += p * iSize;
        gl_Position = projectionMatrix * mv;
        vUv = uv;
        // fade particles that get too close to the lens
        vAlpha = iAlpha * smoothstep(0.4, 1.8, -mv.z);
        vHeat = iHeat;
        vH = iPos.y;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      varying vec2 vUv; varying float vAlpha; varying float vHeat; varying float vH;
      void main(){
        vec4 t = texture2D(uMap, vUv);
        // cool grey vapor, a touch brighter where the jet is dense, darker low to the floor
        vec3 col = mix(vec3(0.74, 0.76, 0.80), vec3(0.95, 0.97, 1.0), vHeat);
        col *= 0.8 + 0.25 * clamp(vH, 0.0, 1.0);
        float a = t.a * vAlpha;
        if (a < 0.003) discard;
        gl_FragColor = vec4(col * t.rgb, a);
      }`,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  scene.add(mesh);

  // simulation state
  const P = new Float32Array(MAX * 3), V = new Float32Array(MAX * 3);
  const age = new Float32Array(MAX), life = new Float32Array(MAX).fill(-1);
  const size = new Float32Array(MAX), grow = new Float32Array(MAX), rot = new Float32Array(MAX), rotV = new Float32Array(MAX);
  const kind = new Uint8Array(MAX), seed = new Float32Array(MAX);
  let cursor = 0, emitAcc = 0;

  function spawn(n, power) {
    const i = cursor;
    cursor = (cursor + 1) % MAX;
    const nz = nozzles[n];
    P[i * 3] = nz.x + (Math.random() - 0.5) * 0.03;
    P[i * 3 + 1] = nz.y - Math.random() * 0.05;
    P[i * 3 + 2] = nz.z + (Math.random() - 0.5) * 0.03;
    const spread = 0.35;
    V[i * 3] = 0.25 + (Math.random() - 0.3) * spread;           // slight rearward rake
    V[i * 3 + 1] = -(6.5 + Math.random() * 2.5) * (0.6 + 0.4 * power);
    V[i * 3 + 2] = (Math.random() - 0.5) * spread;
    age[i] = 0;
    life[i] = 2.6 + Math.random() * 1.8;
    size[i] = 0.07 + Math.random() * 0.05;
    grow[i] = 0.9;
    rot[i] = Math.random() * Math.PI * 2;
    rotV[i] = (Math.random() - 0.5) * 0.6;
    kind[i] = 0;
    seed[i] = Math.random();
  }

  /* ---------- nozzle cores (short, restrained, not a glare) ---------- */
  const coreMat = new THREE.ShaderMaterial({
    uniforms: { uI: { value: 0 }, uT: { value: 0 } },
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uI; uniform float uT; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){
        float along = vUv.y;                     // 1 at nozzle, 0 at tip
        float edge = pow(abs(dot(vN, vV)), 1.5);
        float diamonds = 0.75 + 0.25 * sin(along * 38.0 - uT * 40.0);
        float a = uI * edge * pow(along, 1.6) * diamonds;
        gl_FragColor = vec4(vec3(0.82, 0.9, 1.0) * 1.6, a * 0.55);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const coreGeo = new THREE.CylinderGeometry(0.035, 0.11, 0.55, 24, 1, true);
  coreGeo.translate(0, -0.275, 0);
  const cores = nozzles.map(() => {
    const m = new THREE.Mesh(coreGeo, coreMat);
    m.renderOrder = 6;
    scene.add(m);
    return m;
  });

  // floor wash where the jets land, soft and low intensity
  const washTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'); const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(210,225,255,0.9)'); grd.addColorStop(1, 'rgba(210,225,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  const wash = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: washTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  wash.rotation.x = -Math.PI / 2;
  wash.position.y = 0.004;
  wash.scale.set(3.2, 2.4, 1);
  scene.add(wash);

  const underLight = new THREE.PointLight(0xcfdcff, 0, 4, 2);
  scene.add(underLight);

  const tmp = new THREE.Vector3();

  return {
    // power 0..1 from the scroll timeline
    update(dt, time, power) {
      anchor.updateWorldMatrix(true, false);
      nozzlesLocal.forEach((l, i) => nozzles[i].copy(l).applyMatrix4(anchor.matrixWorld));

      // emission
      const rate = power * (mobile ? 300 : 620);
      emitAcc += rate * dt;
      while (emitAcc >= 1) { emitAcc -= 1; spawn((Math.random() * 2) | 0, power); }

      let n = 0;
      for (let i = 0; i < MAX; i++) {
        if (life[i] < 0) continue;
        age[i] += dt;
        if (age[i] >= life[i]) { life[i] = -1; continue; }
        const k = i * 3;
        if (kind[i] === 0) {
          // jet: fast, narrow, slight gravity, mild drag; widens as it entrains air
          V[k + 1] -= 1.5 * dt;
          const drag = 1 - 0.9 * dt;
          V[k] *= drag; V[k + 2] *= drag;
          size[i] += dt * grow[i] * 1.6;
          if (P[k + 1] <= 0.05) {
            // impact: convert vertical momentum into an outward rolling billow
            kind[i] = 1;
            const sp = Math.abs(V[k + 1]) * (0.35 + Math.random() * 0.4);
            const ang = Math.random() * Math.PI * 2;
            V[k] = Math.cos(ang) * sp + 0.6;   // bias rearward
            V[k + 1] = 0.1 + Math.random() * 0.35;
            V[k + 2] = Math.sin(ang) * sp;
            P[k + 1] = 0.05;
            grow[i] = 0.8 + Math.random() * 0.8;
            age[i] = Math.min(age[i], 0.2);
          }
        } else {
          // ground billow: decelerates fast, keeps swelling, drifts up slowly
          const drag = 1 - 1.6 * dt;
          V[k] *= drag; V[k + 2] *= drag;
          V[k + 1] = V[k + 1] * (1 - 0.8 * dt) + 0.04 * dt;
          size[i] += dt * grow[i] * (1.0 / (1 + age[i] * 0.6));
          rot[i] += rotV[i] * dt;
        }
        P[k] += V[k] * dt; P[k + 1] += V[k + 1] * dt; P[k + 2] += V[k + 2] * dt;

        const t = age[i] / life[i];
        const fadeIn = Math.min(1, age[i] / 0.08);
        const fadeOut = 1 - t * t;
        const alpha = kind[i] === 0 ? 0.5 * fadeIn : 0.32 * fadeOut * (0.7 + 0.3 * seed[i]);

        aPos.array[n * 3] = P[k]; aPos.array[n * 3 + 1] = P[k + 1]; aPos.array[n * 3 + 2] = P[k + 2];
        aSize.array[n] = size[i];
        aAlpha.array[n] = alpha;
        aRot.array[n] = rot[i];
        aHeat.array[n] = kind[i] === 0 ? 0.9 : Math.max(0, 0.5 - age[i] * 0.4);
        n++;
      }
      geo.instanceCount = n;
      aPos.needsUpdate = aSize.needsUpdate = aAlpha.needsUpdate = aRot.needsUpdate = aHeat.needsUpdate = true;

      // cores and lighting
      const flick = 0.9 + 0.1 * Math.sin(time * 70) * Math.sin(time * 31);
      coreMat.uniforms.uI.value = power * flick;
      coreMat.uniforms.uT.value = time;
      cores.forEach((c, i) => {
        c.position.copy(nozzles[i]);
        c.visible = power > 0.01;
        c.scale.set(1, 0.6 + power * 0.6 * flick, 1);
      });
      tmp.copy(nozzles[0]).add(nozzles[1]).multiplyScalar(0.5);
      wash.position.x = tmp.x + 0.2;
      wash.position.z = tmp.z;
      wash.material.opacity = power * 0.16;
      underLight.position.set(tmp.x, Math.max(0.15, tmp.y - 0.15), tmp.z);
      underLight.intensity = power * 2.2;
    },
  };
}
