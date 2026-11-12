struct Settings {
	bbox_min: vec3f,
	bbox_max: vec3f,

	sky_color_0: vec3f,
	sky_color_1: vec3f,
	horizon_color: vec3f,

	sun_direction: vec3f,
	sun_intensity: vec3f,
	sun_radius: f32,

	absorption: vec3f,
	emission: vec3f,
	scattering: vec3f,
	remap_density: vec2f,
	lobe_1_g: f32,
	lobe_2_g: f32,
	lobe_mix: f32,

	threshold: f32,
	exposure: f32,
	tonemapping: u32,

	alpha: f32,
}

struct Camera {
	view_projection: mat4x4f,
	view_projection_inverse: mat4x4f,
	position: vec3f,
	frame_id: u32,
}