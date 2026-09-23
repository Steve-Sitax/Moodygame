import * as THREE from "three";

// Renders the scene into a small target (270 px high, 480x270 on 16:9),
// then draws it full screen with nearest upscale, 5-bit colour and a
// 4x4 Bayer dither. See docs/05-art-direction.md.

export const TARGET_HEIGHT = 270;

const vert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const frag = /* glsl */ `
precision highp float;
uniform sampler2D tScene;
uniform vec2 uRes;
// the PS1 grain, dither and colour steps keep their 270-line size at any render size (settings)
uniform vec2 uFxRes;
uniform float uTime;
uniform float uLevels;
varying vec2 vUv;

float bayer4(vec2 p) {
  ivec2 i = ivec2(mod(p, 4.0));
  int idx = i.x + i.y * 4;
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[idx]) + 0.5) / 16.0 - 0.5;
}

vec3 toSRGB(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 px = floor(vUv * uRes);
  vec2 uv = (px + 0.5) / uRes;
  vec3 c = toSRGB(texture2D(tScene, uv).rgb);
  vec2 fx = floor(vUv * uFxRes);

  // grade: lift shadows toward cold green-grey, crush a little, desaturate
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, 0.78);
  c = c * vec3(0.97, 1.0, 0.98) + vec3(0.010, 0.016, 0.018) * (1.0 - l);
  c = pow(c, vec3(1.08));

  // vignette, the cellar-found tape look
  vec2 d = vUv - 0.5;
  c *= 1.0 - dot(d, d) * 0.95;

  // grain, per low-res pixel, slow
  float g = hash(fx + floor(uTime * 12.0)) - 0.5;
  c += g * 0.018;

  // 5-bit quantize with ordered dither
  float levels = uLevels - 1.0;
  c = floor(c * levels + 0.5 + bayer4(fx)) / levels;

  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

export class RetroPass {
  readonly target: THREE.WebGLRenderTarget;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly mat: THREE.ShaderMaterial;
  width = 480;
  height = TARGET_HEIGHT;
  /** Render height from the settings: TARGET_HEIGHT is the PS1 look, 0 = the full window. */
  renderHeight = TARGET_HEIGHT;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.target = new THREE.WebGLRenderTarget(this.width, this.height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      type: THREE.HalfFloatType,
    });
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        tScene: { value: this.target.texture },
        uRes: { value: new THREE.Vector2(this.width, this.height) },
        uFxRes: { value: new THREE.Vector2(480, TARGET_HEIGHT) },
        uTime: { value: 0 },
        uLevels: { value: 32 }, // 5 bits per channel
      },
      depthTest: false,
      depthWrite: false,
    });
    this.quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat));
  }

  /** Keep the render height (270 px: 480 wide at 16:9), follow the window aspect. */
  resize(aspect: number, windowHeight = TARGET_HEIGHT): void {
    this.height = Math.max(1, Math.round(this.renderHeight > 0 ? Math.min(this.renderHeight, windowHeight) : windowHeight));
    this.width = Math.max(1, Math.round(this.height * aspect));
    this.target.setSize(this.width, this.height);
    (this.mat.uniforms.uRes.value as THREE.Vector2).set(this.width, this.height);
    (this.mat.uniforms.uFxRes.value as THREE.Vector2).set(Math.round(TARGET_HEIGHT * aspect), TARGET_HEIGHT);
  }

  /** PS1 colour (5-bit with dither) or full colour. */
  setPsxColour(on: boolean): void {
    this.mat.uniforms.uLevels.value = on ? 32 : 256;
  }

  render(scene: THREE.Scene, camera: THREE.Camera, time: number): void {
    this.mat.uniforms.uTime.value = time;
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.quadScene, this.quadCam);
  }
}
