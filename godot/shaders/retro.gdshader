shader_type canvas_item;
// The screen pass (the browser's retro/retroPass.ts): the small picture drawn full screen with nearest pixels, the
// grade, the vignette, the grain, 5-bit colour with a 4 x 4 Bayer dither. The grain, the dither and the colour steps
// keep their 270-line size at any render size.
uniform vec2 res = vec2(1280.0, 720.0);
uniform vec2 fx_res = vec2(480.0, 270.0);
uniform float levels = 32.0;

float bayer4(vec2 p) {
	ivec2 i = ivec2(mod(p, 4.0));
	int idx = i.x + i.y * 4;
	int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
	return (float(m[idx]) + 0.5) / 16.0 - 0.5;
}

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void fragment() {
	vec2 px = floor(UV * res);
	vec3 c = texture(TEXTURE, (px + 0.5) / res).rgb;
	vec2 fx = floor(UV * fx_res);
	// grade: lift shadows toward cold green-grey, crush a little, desaturate
	float l = dot(c, vec3(0.299, 0.587, 0.114));
	c = mix(vec3(l), c, 0.78);
	c = c * vec3(0.97, 1.0, 0.98) + vec3(0.010, 0.016, 0.018) * (1.0 - l);
	c = pow(c, vec3(1.08));
	vec2 d = UV - 0.5;
	c *= 1.0 - dot(d, d) * 0.95;
	float g = hash(fx + floor(TIME * 12.0)) - 0.5;
	c += g * 0.018;
	float lv = levels - 1.0;
	c = floor(c * lv + 0.5 + bayer4(fx)) / lv;
	COLOR = vec4(clamp(c, 0.0, 1.0), 1.0);
}
