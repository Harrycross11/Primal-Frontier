// Renderer, sky, image-based lighting and post-processing.
// "High" quality adds ambient occlusion, bloom and colour grading; "Low" renders directly.

import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

export type Quality = 'high' | 'low';

/** Low, hazy sun: late afternoon on a dead planet. */
export const SUN_DIRECTION = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 16), THREE.MathUtils.degToRad(215));
export const HAZE = new THREE.Color(0xb8a184);

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
    this.renderer.toneMappingExposure = 0.95;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 1500);

    // Sky dome plus an environment map baked from it, so metal and wet surfaces reflect the sky.
    const sky = new Sky();
    sky.scale.setScalar(1200);
    const u = sky.material.uniforms;
    u.turbidity.value = 14;
    u.rayleigh.value = 0.9;
    u.mieCoefficient.value = 0.02;
    u.mieDirectionalG.value = 0.86;
    u.sunPosition.value.copy(SUN_DIRECTION);
    scene.add(sky);
    const envScene = new THREE.Scene();
    const envSky = new Sky();
    envSky.scale.setScalar(100);
    envSky.material.uniforms = THREE.UniformsUtils.clone(u);
    envScene.add(envSky);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    scene.environment = pmrem.fromScene(envScene, 0.04).texture;
    scene.environmentIntensity = 0.55;
    pmrem.dispose();

    const target = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(scene, this.camera));
    this.gtao = new GTAOPass(scene, this.camera, innerWidth, innerHeight);
    this.gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.5, scale: 1.1 });
    this.gtao.blendIntensity = 0.85;
    this.composer.addPass(this.gtao);
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.22, 0.6, 0.92));
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
    if (this.quality === 'high') this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
