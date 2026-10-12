// Height is measured in metres. Raw position derivatives keep slopes stable at any camera distance.
vec3 metric_surface_normal(vec3 position, vec3 normal, float height) {
    vec3 sx = dFdx(position);
    vec3 sy = dFdy(position);
    vec3 r1 = cross(sy, normal);
    vec3 r2 = cross(normal, sx);
    float determinant = dot(sx, r1);
    vec3 gradient = sign(determinant) * (dFdx(height) * r1 + dFdy(height) * r2);
    return normalize(max(abs(determinant), 1e-12) * normal - gradient);
}
