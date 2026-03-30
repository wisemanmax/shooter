/**
 * src/shell/postprocessing.ts
 * Post-processing pipeline: bloom, chromatic aberration on damage, vignette.
 * Uses Three.js EffectComposer with render passes.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/* ─── Chromatic Aberration Shader ─────────────────────────────── */

const ChromaticAberrationShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uIntensity: { value: 0.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uIntensity;
    varying vec2 vUv;
    void main() {
      vec2 dir = vUv - vec2(0.5);
      float d = length(dir);
      vec2 offset = dir * d * uIntensity * 0.04;
      float r = texture2D(tDiffuse, vUv + offset).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - offset).b;
      gl_FragColor = vec4(r, g, b, 1.0);
    }
  `,
};

/* ─── Vignette Shader ─────────────────────────────────────────── */

const DamageVignetteShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uDamage: { value: 0.0 },
    uShieldBreak: { value: 0.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uDamage;
    uniform float uShieldBreak;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      float d = length(vUv - vec2(0.5)) * 2.0;
      // Red vignette for health damage
      float redVig = smoothstep(0.4, 1.2, d) * uDamage * 0.6;
      color.rgb = mix(color.rgb, vec3(0.8, 0.08, 0.05), redVig);
      // Blue flash for shield break
      float blueVig = smoothstep(0.3, 1.0, d) * uShieldBreak * 0.5;
      color.rgb = mix(color.rgb, vec3(0.2, 0.5, 1.0), blueVig);
      gl_FragColor = color;
    }
  `,
};

/* ─── PostFX Manager ──────────────────────────────────────────── */

export class PostFX {
  private composer!: EffectComposer;
  private bloomPass!: UnrealBloomPass;
  private chromaPass!: ShaderPass;
  private vignettePass!: ShaderPass;

  private chromaIntensity = 0;
  private damageIntensity = 0;
  private shieldBreakIntensity = 0;

  init(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    this.composer = new EffectComposer(renderer);

    // Base render
    this.composer.addPass(new RenderPass(scene, camera));

    // Bloom — subtle glow for muzzle flash, emissives, abilities
    const size = renderer.getSize(new THREE.Vector2());
    this.bloomPass = new UnrealBloomPass(size, 0.4, 0.3, 0.85);
    this.composer.addPass(this.bloomPass);

    // Chromatic aberration on damage
    this.chromaPass = new ShaderPass(ChromaticAberrationShader);
    this.composer.addPass(this.chromaPass);

    // Damage vignette (replaces CSS overlay — now GPU-based)
    this.vignettePass = new ShaderPass(DamageVignetteShader);
    this.composer.addPass(this.vignettePass);

    // Output pass for tone mapping / color space
    this.composer.addPass(new OutputPass());
  }

  /** Call when player takes damage */
  onDamage(): void {
    this.chromaIntensity = Math.min(this.chromaIntensity + 1.0, 2.0);
    this.damageIntensity = Math.min(this.damageIntensity + 0.8, 1.0);
  }

  /** Call when shield breaks */
  onShieldBreak(): void {
    this.chromaIntensity = Math.min(this.chromaIntensity + 1.5, 2.5);
    this.shieldBreakIntensity = 1.0;
  }

  /** Update per frame — decays all effects */
  tick(dt: number): void {
    // Decay chromatic aberration
    this.chromaIntensity = Math.max(0, this.chromaIntensity - dt * 4.0);
    this.chromaPass.uniforms.uIntensity.value = this.chromaIntensity;

    // Decay damage vignette
    this.damageIntensity = Math.max(0, this.damageIntensity - dt * 3.0);
    this.vignettePass.uniforms.uDamage.value = this.damageIntensity;

    // Decay shield break vignette
    this.shieldBreakIntensity = Math.max(0, this.shieldBreakIntensity - dt * 3.5);
    this.vignettePass.uniforms.uShieldBreak.value = this.shieldBreakIntensity;
  }

  /** Render the post-processing pipeline (replaces renderer.render) */
  render(): void {
    this.composer.render();
  }

  /** Handle window resize */
  resize(width: number, height: number): void {
    this.composer.setSize(width, height);
  }
}

export const postFX = new PostFX();
