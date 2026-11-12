@group(0) @binding(0) var<uniform> camera: Camera;

@group(1) @binding(0) var<uniform> settings: Settings;
@group(1) @binding(1) var density: texture_3d<f32>;
@group(1) @binding(2) var density_sampler: sampler;

@group(2) @binding(0) var blue_noise: texture_2d<f32>;
@group(2) @binding(1) var blue_noise_sampler: sampler;

const VERTICES = array<vec2f, 3>(
	vec2f(-1.0, -1.0),
	vec2f( 3.0, -1.0),
	vec2f(-1.0,  3.0),
);

struct VertexOut {
	@builtin(position) position: vec4f,
	@location(0) world_position: vec4f,
}

@vertex
fn vertex_main(@builtin(vertex_index) id: u32) -> VertexOut {
	let clip_space = vec4f(VERTICES[id], 0.0, 1.0);

	return VertexOut(
		clip_space,
		camera.view_projection_inverse * clip_space,
	);
}

@fragment
fn fragment_main(in: VertexOut) -> @location(0) vec4f {
    let world_position = in.world_position.xyz / in.world_position.w;
    let ray = Ray(camera.position, normalize(world_position - camera.position));

	let intersection = intersect_bbox(ray, Bbox(settings.bbox_min, settings.bbox_max), true);

	let sky = sky_color(ray.direction);

	if (intersection.y < intersection.x) {
		return vec4f(sky, 1.0);
	}

	let extinction = settings.absorption + settings.scattering;

    // The sky_ambient term is an eyeballed approximation to scattering from the sky.
	let sky_ambient = (settings.sky_color_0 + settings.sky_color_1 + settings.horizon_color) / 3.0;

	// Use screen-space blue noise to randomize sample positions along
	// the camera ray to prevent slicing artefacts.

	// NB: Noise values of exactly 0 or 1 cause floating-point errors
	// when intersecting the shadow ray with the bbox, because the
	// ray origin is exactly on the bbox boundary. Re-map the noise
	// values to fix that: texture value X becomes the middle of the
	// normalized segment [X, X+1].
	let noise = mix(0.5 / 256.0, 255.5 / 256.0, textureSampleLevel(blue_noise, blue_noise_sampler, in.position.xy / vec2f(textureDimensions(blue_noise, 0)), 0).r);

    const PRIMARY_STEPS = 32;
    const SHADOW_STEPS = 8;

    var optical_depth = vec3f(0.0);
    var accumulated_light = vec3f(0.0);
    let dt = (intersection.y - intersection.x) / f32(PRIMARY_STEPS);
    for (var i = 0; i < PRIMARY_STEPS; i += 1) {
        let t = intersection.x + dt * (f32(i) + noise);
        let p = ray.origin + ray.direction * t;
        let d = sample_density(p);


        let light_ray = Ray(p, settings.sun_direction);
        let light_intersection = intersect_bbox(light_ray, Bbox(settings.bbox_min, settings.bbox_max), true);

        let ds = (light_intersection.y - light_intersection.x) / f32(SHADOW_STEPS);
        var light_optical_depth = vec3f(0.0);
        for (var j = 0; j < SHADOW_STEPS; j += 1) {
            let s = light_intersection.x + ds * (f32(j) + 0.5);
            let q = light_ray.origin + light_ray.direction * s;
            let d = sample_density(q);
            light_optical_depth += extinction * d * ds;
        }
        let total_inscatter = settings.sun_intensity * exp(- light_optical_depth) * phase_function(settings.sun_direction, ray.direction) + sky_ambient;

        // Because optical depth is used in attenuating in-scattered and emitted light,
        // updating it before or after updating accumulated light introduces integration
        // errors. Updating it by 1/2 both before and after reduces these errors.
        let half_optical_depth_change = extinction * d * dt * 0.5;
        optical_depth += half_optical_depth_change;
        accumulated_light += (settings.emission + total_inscatter * settings.scattering) * d * dt * exp(- optical_depth);
        optical_depth += half_optical_depth_change;
    }

    let transmisstion = exp(- optical_depth);
    return vec4f(accumulated_light + sky * transmisstion, 1.0);
}