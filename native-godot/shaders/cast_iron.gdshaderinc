uniform float surface_depth = 1.0;
varying vec3 iron_position;

float iron_hash(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
}
float iron_noise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(iron_hash(i), iron_hash(i + vec3(1,0,0)), f.x), mix(iron_hash(i + vec3(0,1,0)), iron_hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(iron_hash(i + vec3(0,0,1)), iron_hash(i + vec3(1,0,1)), f.x), mix(iron_hash(i + vec3(0,1,1)), iron_hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
// Millimetre casting pits and wider corrosion cavities, anchored to the model rather than a small atlas cell.
float iron_height(vec3 p) {
    float fine_fade = 1.0 - smoothstep(0.001, 0.005, max(length(dFdx(p)), length(dFdy(p))));
    float pits = pow(clamp((0.53 - iron_noise(p * 260.0)) * 2.1, 0.0, 1.0), 2.0);
    float dents = pow(clamp((0.50 - iron_noise(p * 48.0 + 13.0)) * 2.2, 0.0, 1.0), 2.0);
    float worn = smoothstep(0.17, 0.27, p.y) * (1.0 - smoothstep(0.48, 0.59, p.y));
    return surface_depth * (-0.0011 * pits * fine_fade * (1.0 - worn * 0.6) - 0.0028 * dents + 0.00022 * iron_noise(p * 115.0) * fine_fade);
}
void iron_finish(vec3 p, out vec3 colour, out float roughness, out float metalness, out float polish) {
    float patch = iron_noise(p * 13.0 + 7.0) * 0.7 + iron_noise(p * 42.0) * 0.3;
    float rust = smoothstep(0.42, 0.66, patch);
    polish = smoothstep(0.17, 0.27, p.y) * (1.0 - smoothstep(0.48, 0.59, p.y)) * (0.35 + 0.65 * iron_noise(p * 25.0));
    rust *= 1.0 - polish * 0.65;
    vec3 iron = vec3(0.058, 0.063, 0.067) * (0.8 + 0.4 * iron_noise(p * 75.0));
    vec3 oxide = mix(vec3(0.075, 0.025, 0.010), vec3(0.20, 0.065, 0.019), iron_noise(p * 38.0));
    colour = mix(iron, oxide, rust) + vec3(0.019) * polish;
    roughness = clamp(mix(0.65, 0.94, rust) - polish * 0.30, 0.32, 0.96);
    metalness = mix(0.78, 0.08, rust);
}
