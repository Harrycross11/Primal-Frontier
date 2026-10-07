// Renderer, sky, image-based lighting and post-processing.
// "High" quality adds ambient occlusion, bloom, sun shafts, soft shadows and a film grade;
// "Medium" keeps all of that but the ambient occlusion, at one pixel per screen pixel;
// "Low" renders directly.

import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

export type Quality = 'high' | 'medium' | 'low';
export const QUALITIES: Quality[] = ['high', 'medium', 'low'];

/** Low, hazy sun: late afternoon on a dead planet. */
export const SUN_DIRECTION = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 16), THREE.MathUtils.degToRad(215));
export const HAZE = new THREE.Color(0xbcb09c);
const ZENITH = new THREE.Color(0x56708e);

/**
 * The photographed sky (Poly Haven's "Wasteland Clouds", CC0), and where its sun is: 7.7° up,
 * 0.6 of the way across the image. The photo is turned and stretched so its sun sits on ours.
 */
const SKY_URL = '/textures/sky.hdr';
const PHOTO_SUN_U = 0.5996;
const PHOTO_SUN_ELEVATION = THREE.MathUtils.degToRad(7.7);
/** Scales the photo's brightness to match the lighting the game was tuned under. */
const PHOTO_EXPOSURE = 0.3;

interface PhotoSky {
  map: { value: THREE.Texture | null };
  mix: { value: number };
}

/**
 * A dusty sky dome: hazy brown at the horizon (matching the fog, so distant land melts into
 * it), grey-blue overhead, a glow around the sun that scatters through the dust, and slow
 * drifting layers of cloud lit from the sun's side.
 */
function skyDome(radius: number, time: { value: number }, photo: PhotoSky): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      horizon: { value: HAZE },
      zenith: { value: ZENITH },
      sunDir: { value: SUN_DIRECTION },
      sunColor: { value: new THREE.Color(0xffdcb4) },
      time,
      photoMap: photo.map,
      photoMix: photo.mix,
      photoTurn: { value: (PHOTO_SUN_U - 0.5) * Math.PI * 2 - Math.atan2(SUN_DIRECTION.z, SUN_DIRECTION.x) },
      photoSun: { value: new THREE.Vector2(Math.asin(SUN_DIRECTION.y), PHOTO_SUN_ELEVATION) },
      photoExposure: { value: PHOTO_EXPOSURE },
    },
    vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`,
    fragmentShader: `
      uniform vec3 horizon; uniform vec3 zenith; uniform vec3 sunDir; uniform vec3 sunColor; uniform float time; varying vec3 vDir;
      uniform sampler2D photoMap; uniform float photoMix; uniform float photoTurn; uniform vec2 photoSun; uniform float photoExposure;
      const float PI = 3.141592653589793;
      // The photographed sky in direction d, its elevations bent so the photo's sun (photoSun.y)
      // lands at ours (photoSun.x) while the horizon and zenith stay put.
      vec3 photoSky(vec3 d) {
        float e = asin(clamp(d.y, -1.0, 1.0));
        float s = photoSun.x;
        float p = photoSun.y;
        float e2 = e < s ? e * p / s : p + (e - s) * (PI * 0.5 - p) / (PI * 0.5 - s);
        float a = atan(d.z, d.x) + photoTurn;
        vec2 uv = vec2(fract(a / (2.0 * PI) + 0.5), e2 / PI + 0.5);
        vec3 c = texture2D(photoMap, uv).rgb * photoExposure;
        // The photo's glow round its sun is far brighter than ours and would flood the light
        // shafts; squash everything above white. Our own sun disc is drawn on top.
        float l = max(max(c.r, c.g), c.b);
        if (l > 1.0) c *= (1.0 + (l - 1.0) * 0.12) / l;
        return c;
      }
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }
      float fbm(vec2 p) {
        float v = 0.0; float a = 0.5;
        for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
        return v;
      }
      void main() {
        vec3 d = normalize(vDir);
        vec3 sd = normalize(sunDir);
        float h = max(d.y, 0.0);
        vec3 col = mix(horizon, zenith, pow(h, 0.5));
        // Lighter, warmer haze low down on the sun's side of the sky.
        float side = max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(sd.x, 0.0, sd.z))), 0.0);
        col = mix(col, horizon * 1.25, side * side * (1.0 - h) * 0.5);
        float s = max(dot(d, sd), 0.0);
        // Forward scattering: a wide warm halo and a tighter bright one.
        col += sunColor * (pow(s, 5.0) * 0.4 + pow(s, 48.0) * 0.8 + pow(s, 400.0) * 1.5);
        // Clouds: noise projected onto a flat layer overhead, drifting with the wind.
        if (d.y > 0.0) {
          vec2 uv = d.xz / (d.y + 0.12) * 1.6 + vec2(time * 0.006, time * 0.002);
          float n = fbm(uv);
          float cover = smoothstep(0.48, 0.78, n);
          // Thicker parts are darker underneath; edges near the sun glow.
          float thick = smoothstep(0.55, 0.95, fbm(uv * 1.7 + 3.1));
          vec3 cloud = mix(horizon * 1.15, zenith * 0.9 + horizon * 0.25, thick * 0.7);
          cloud += sunColor * pow(s, 8.0) * (1.0 - thick) * 0.9;
          float fade = smoothstep(0.0, 0.25, d.y);
          col = mix(col, cloud, cover * fade * 0.8);
        }
        if (photoMix > 0.0) {
          // Low down the photo fades into the haze, so it meets the fogged land without a seam.
          vec3 photo = photoSky(d);
          photo = mix(horizon, photo, smoothstep(-0.02, 0.14, d.y));
          col = mix(col, photo, photoMix);
        }
        col += sunColor * smoothstep(0.9993, 0.9997, s) * 12.0;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), mat);
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * Light shafts: streaks the brightest parts of the image (sky around the sun, gaps between
 * trees) away from the sun's position on screen. Works in linear light before tone mapping.
 */
const SunShaftShader = {
  uniforms: { tDiffuse: { value: null }, sunUv: { value: new THREE.Vector2(0.5, 0.5) }, strength: { value: 0 }, aspect: { value: 1 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 sunUv; uniform float strength; uniform float aspect; varying vec2 vUv;
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      if (strength <= 0.0) { gl_FragColor = base; return; }
      vec2 delta = (vUv - sunUv) / 40.0 * 0.85;
      vec2 p = vUv;
      float decay = 1.0;
      vec3 rays = vec3(0.0);
      for (int i = 0; i < 40; i++) {
        p -= delta;
        vec3 c = texture2D(tDiffuse, clamp(p, 0.0, 1.0)).rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        rays += c * smoothstep(1.1, 2.2, l) * decay;
        decay *= 0.955;
      }
      vec2 off = (vUv - sunUv) * vec2(aspect, 1.0);
      float near = 1.0 - smoothstep(0.0, 0.9, length(off));
      gl_FragColor = vec4(base.rgb + rays / 40.0 * strength * near * vec3(1.0, 0.86, 0.66), base.a);
    }`,
};

/** Warm, filmic grade: gentle desaturation, lens vignette, a touch of fringing at the edges, and grain. */
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, amount: { value: 1 }, time: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float amount; uniform float time; varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 fromCentre = vUv - 0.5;
      float edge = dot(fromCentre, fromCentre);
      // Chromatic fringing grows toward the corners, like a cheap lens.
      vec2 ca = fromCentre * edge * 0.006 * amount;
      vec4 c = texture2D(tDiffuse, vUv);
      c.r = texture2D(tDiffuse, vUv + ca).r;
      c.b = texture2D(tDiffuse, vUv - ca).b;
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      vec3 graded = mix(vec3(l), c.rgb, 0.96);
      // Warm highlights, slightly cool shadows.
      graded *= mix(vec3(0.95, 0.98, 1.04), vec3(1.05, 1.0, 0.9), smoothstep(0.1, 0.7, l));
      graded = (graded - 0.5) * 1.1 + 0.5;
      float v = smoothstep(0.95, 0.3, length(fromCentre));
      graded *= mix(0.8, 1.0, v);
      // Film grain, stronger in the shadows.
      float g = hash(vUv * 1000.0 + fract(time) * 100.0) - 0.5;
      graded += g * 0.022 * (1.0 - l * 0.6);
      c.rgb = mix(c.rgb, graded, amount);
      gl_FragColor = c;
    }`,
};

export class Graphics {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private gtao: GTAOPass;
  private bloom: UnrealBloomPass;
  private shafts: ShaderPass;
  private grade: ShaderPass;
  private sky: THREE.Mesh;
  private time = { value: 0 };
  private clock = new THREE.Clock();
  quality: Quality;

  constructor(
    container: HTMLElement,
    private scene: THREE.Scene,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 1500);

    // Sky dome plus an environment map baked from it, so surfaces pick up the sky's colour.
    // The dome is drawn in code until the photographed sky loads, then shows the photo.
    const photo: PhotoSky = { map: { value: null }, mix: { value: 0 } };
    this.sky = skyDome(1000, this.time, photo);
    scene.add(this.sky);
    const envScene = new THREE.Scene();
    envScene.add(skyDome(50, { value: 0 }, photo));
    // A dark ground half, so reflections pick up earth below the horizon rather than sky.
    const ground = new THREE.Mesh(new THREE.CircleGeometry(48, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x4a4034 }));
    ground.position.y = -1;
    envScene.add(ground);
    const bakeEnvironment = () => {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      scene.environment?.dispose();
      scene.environment = pmrem.fromScene(envScene, 0.04).texture;
      pmrem.dispose();
    };
    bakeEnvironment();
    scene.environmentIntensity = 0.55;
    new HDRLoader().load(SKY_URL, (tex) => {
      tex.wrapS = THREE.RepeatWrapping;
      tex.minFilter = tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      photo.map.value = tex;
      photo.mix.value = 1;
      bakeEnvironment();
    });

    const target = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(scene, this.camera));
    this.gtao = new GTAOPass(scene, this.camera, innerWidth, innerHeight);
    this.gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.5, scale: 1.1 });
    this.gtao.blendIntensity = 0.85;
    // The occlusion pass draws everything with one plain material, so cut-out leaf cards would
    // shade as solid squares. Leave anything marked noAO out of it.
    const gtao = this.gtao as unknown as { _overrideVisibility(): void; _visibilityCache: THREE.Object3D[] };
    gtao._overrideVisibility = () => {
      scene.traverse((o) => {
        const line = (o as THREE.Points).isPoints || (o as THREE.Line).isLine;
        if ((line || o.userData.noAO) && o.visible) {
          o.visible = false;
          gtao._visibilityCache.push(o);
        }
      });
    };
    this.composer.addPass(this.gtao);
    this.shafts = new ShaderPass(SunShaftShader);
    this.composer.addPass(this.shafts);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.22, 0.5, 1.6);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);

    let saved: string | null = null;
    try {
      saved = localStorage.getItem('pf-quality');
    } catch {
      /* storage unavailable */
    }
    this.quality = 'high';
    this.setQuality(QUALITIES.includes(saved as Quality) ? (saved as Quality) : 'high');

    addEventListener('resize', () => this.resize());
  }

  setQuality(q: Quality) {
    this.quality = q;
    // Ambient occlusion is the costliest pass, and high-density screens draw up to three times
    // the pixels; the lower settings drop both.
    this.gtao.enabled = q === 'high';
    const ratio = q === 'high' ? Math.min(devicePixelRatio, 1.75) : Math.min(devicePixelRatio, 1);
    if (ratio !== this.renderer.getPixelRatio()) {
      this.renderer.setPixelRatio(ratio);
      this.composer.setPixelRatio(ratio);
      this.resize();
    }
    try {
      localStorage.setItem('pf-quality', q);
    } catch {
      /* storage unavailable */
    }
  }

  private resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer.setSize(innerWidth, innerHeight);
    this.bloom.resolution.set(innerWidth / 2, innerHeight / 2);
  }

  private sunScreen = new THREE.Vector3();
  private forward = new THREE.Vector3();

  render() {
    this.time.value += this.clock.getDelta();
    this.sky.position.copy(this.camera.position);
    if (this.quality !== 'low') {
      // Shafts only while the sun is in front of the camera, fading in as it comes on screen.
      this.camera.getWorldDirection(this.forward);
      const facing = this.forward.dot(SUN_DIRECTION);
      this.sunScreen.copy(this.camera.position).addScaledVector(SUN_DIRECTION, 500).project(this.camera);
      const u = this.shafts.uniforms;
      u.sunUv.value.set(this.sunScreen.x * 0.5 + 0.5, this.sunScreen.y * 0.5 + 0.5);
      u.strength.value = THREE.MathUtils.smoothstep(facing, 0.2, 0.7) * 1.4;
      u.aspect.value = this.camera.aspect;
      this.shafts.enabled = u.strength.value > 0;
      this.grade.uniforms.time.value = this.time.value;
      this.composer.render();
    } else this.renderer.render(this.scene, this.camera);
  }
}
