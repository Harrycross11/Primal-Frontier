// Renderer, sky, image-based lighting and post-processing.
// "High" quality adds ambient occlusion and colour grading; "Low" renders directly.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

export type Quality = 'high' | 'low';

/** Low, hazy sun: late afternoon on a dead planet. */
export const SUN_DIRECTION = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 16), THREE.MathUtils.degToRad(215));
export const HAZE = new THREE.Color(0xb4a084);
const ZENITH = new THREE.Color(0x6b7178);

/**
 * A dusty sky dome: hazy brown at the horizon (matching the fog, so distant land melts into
 * it), grey-blue overhead, and a soft sun glow. Simpler and moodier than a clear-sky model.
 */
function skyDome(radius: number): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      horizon: { value: HAZE },
      zenith: { value: ZENITH },
      sunDir: { value: SUN_DIRECTION },
      sunColor: { value: new THREE.Color(0xffd2a0) },
    },
    vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`,
    fragmentShader: `
      uniform vec3 horizon; uniform vec3 zenith; uniform vec3 sunDir; uniform vec3 sunColor; varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        vec3 col = mix(horizon, zenith, pow(h, 0.55));
        float s = max(dot(d, normalize(sunDir)), 0.0);
        col += sunColor * (pow(s, 6.0) * 0.35 + pow(s, 64.0) * 0.6);
        col += sunColor * smoothstep(0.9993, 0.9997, s) * 6.0;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), mat);
  mesh.frustumCulled = false;
  return mesh;
}

/** Warm, slightly desaturated grade with a vignette, applied after tone mapping. */
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, amount: { value: 1 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float amount; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      vec3 graded = mix(vec3(l), c.rgb, 0.82);
      graded *= vec3(1.04, 1.0, 0.92);
      graded = (graded - 0.5) * 1.08 + 0.5;
      float v = smoothstep(0.95, 0.35, length(vUv - 0.5));
      c.rgb = mix(c.rgb, graded * mix(0.72, 1.0, v), amount);
      gl_FragColor = c;
    }`,
};

export class Graphics {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private gtao: GTAOPass;
  private sky: THREE.Mesh;
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
    this.renderer.toneMappingExposure = 1.15;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 1500);

    // Sky dome plus an environment map baked from it, so surfaces pick up the sky's colour.
    this.sky = skyDome(1000);
    scene.add(this.sky);
    const envScene = new THREE.Scene();
    envScene.add(skyDome(50));
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    scene.environment = pmrem.fromScene(envScene, 0.04).texture;
    scene.environmentIntensity = 0.5;
    pmrem.dispose();

    const target = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(scene, this.camera));
    this.gtao = new GTAOPass(scene, this.camera, innerWidth, innerHeight);
    this.gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.5, scale: 1.1 });
    this.gtao.blendIntensity = 0.85;
    this.composer.addPass(this.gtao);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(new ShaderPass(GradeShader));

    let saved: string | null = null;
    try {
      saved = localStorage.getItem('pf-quality');
    } catch {
      /* storage unavailable */
    }
    this.quality = saved === 'low' ? 'low' : 'high';

    addEventListener('resize', () => this.resize());
  }

  setQuality(q: Quality) {
    this.quality = q;
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
  }

  render() {
    this.sky.position.copy(this.camera.position);
    if (this.quality === 'high') this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
