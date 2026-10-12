shader_type spatial;
render_mode diffuse_burley, cull_back;
#include "res://shaders/surface_normal.gdshaderinc"
#include "res://shaders/cast_iron.gdshaderinc"

void vertex() { iron_position = VERTEX; }
void fragment() {
    vec3 colour;
    float rough, metal, polish;
    iron_finish(iron_position, colour, rough, metal, polish);
    NORMAL = metric_surface_normal(VERTEX, NORMAL, iron_height(iron_position));
    ALBEDO = colour;
    ROUGHNESS = rough;
    METALLIC = metal;
}
