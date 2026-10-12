shader_type canvas_item;
// The screen pass (the browser's retro/retroPass.ts): the world's picture drawn full screen, smoothly scaled, with the
// grade, the vignette and a fine film grain. Steve, 2026-10-11: no PS1 look (no big pixels, no colour steps, no
// dither): the fog and the grain carry the mood.
uniform vec2 res = vec2(1280.0, 720.0);
uniform float picture_time = -1.0;

// (a hash without sin: fract(sin(...)) loses its bits on big numbers on this card, issue #58)
float hash(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}

void fragment() {
	vec3 c = texture(TEXTURE, UV).rgb;
	// grade: lift shadows toward cold green-grey, crush a little, desaturate
	float l = dot(c, vec3(0.299, 0.587, 0.114));
	c = mix(vec3(l), c, 0.78);
	c = c * vec3(0.97, 1.0, 0.98) + vec3(0.010, 0.016, 0.018) * (1.0 - l);
	c = pow(c, vec3(1.08));
	vec2 d = UV - 0.5;
	c *= 1.0 - dot(d, d) * 0.95;
	// film grain: fine (two screen pixels a grain), a little stronger in the shadows, 24 times a second
	float t = floor((picture_time >= 0.0 ? picture_time : TIME) * 24.0);
	float g = hash(floor(FRAGCOORD.xy * 0.5) + vec2(t * 17.0, t * 31.0)) - 0.5;
	c += g * mix(0.028, 0.016, l);
	COLOR = vec4(clamp(c, 0.0, 1.0), 1.0);
}
