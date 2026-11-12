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
    var ray = Ray(camera.position, normalize(world_position - camera.position));

	var rng = RNGState(0u);
	init_random(&rng, u32(in.position.x));
	init_random(&rng, u32(in.position.y));
	init_random(&rng, u32(camera.frame_id));

	// Which color channel we'll work with
	// TODO: use a better method to incorporate wavelength dependance
	// https://la.disneyresearch.com/wp-content/uploads/Spectral-and-Decomposition-Tracking-for-Rendering-Heterogeneous-Volumes-Paper1.pdf?utm_source=chatgpt.com
	let k = uniform_uint(&rng, 3u);

	// Accumulated color value
	var value = 0.0;

	// Monte-Carlo factor (i.e. inverse probability)
	var factor = 3.0;

    // The sky_ambient term is an eyeballed approximation to scattering from the sky.
	let sky_ambient = (settings.sky_color_0[k] + settings.sky_color_1[k] + settings.horizon_color[k]) / 3.0;

	let extinction = settings.absorption[k] + settings.scattering[k];

	if (extinction < 0.001) {
		// Zero extinction breaks delta tracking (no sample is ever accepted).
		// In this case we just need to integrate emission along the ray.
		// Do this with a uniformly-generated samples.

		// TODO:
		// Low but nonzero extinction values still converge very slowly.
		// Split the integral into direct emission + in-scattering,
		// estimate them separately (ratio tracking + delta tracking).

		let intersection = intersect_bbox(ray, Bbox(settings.bbox_min, settings.bbox_max), true);

		value += factor * sky_color(ray.direction)[k];

		if (intersection.x < intersection.y) {
			let t = intersection.x + uniform_float(&rng) * (intersection.y - intersection.x);
			let p = ray.origin + t * ray.direction;
			let d = sample_density_tricubic(p, &rng);
			factor /= intersection.y - intersection.x;
			value += factor * settings.emission[k] * d;
		}
	} else {
		// Main scattering loop
		var running = true;
		while (running) {
			let intersection = intersect_bbox(ray, Bbox(settings.bbox_min, settings.bbox_max), true);

			if (intersection.y < intersection.x) {
				value += factor * sky_color(ray.direction)[k];
				running = false;
				break;
			}

			var t = intersection.x;

			// Delta tracking loop: walk along the ray with
			// exponentially-distributed steps, and accept
			// the current sample with probability proportional
			// to extinction factor. The distribution of accepted
			// samples has probability extinction * transmission,
			// where transmission = exp(- integral of extinction).
			// Thus, this serves as an importance sampling strategy
			// for the volumetric scattering integral.
			while (true) {
				let M = max(0.001, extinction);
				t -= log(uniform_float(&rng)) / M;
				if (t > intersection.y) {
					value += factor * sky_color(ray.direction)[k];
					running = false;
					break;
				}
				let p = ray.origin + t * ray.direction;
				let d = sample_density_tricubic(p, &rng);
					
				let threshold = extinction * d;
				if (uniform_float(&rng) < threshold / M) {
					factor /= threshold;

					value += settings.emission[k] * d * factor;

					// Russian roulette recursive ray termination
					// Termination probability was eye-balled :)
					let roulette = max(0.0, 1.0 - factor / 0.1);

					if (uniform_float(&rng) < roulette) {
						running = false;
						break;
					} else {
						// Importance-sample sun vs the sky
						let sun_weight = max(1.0, settings.sun_intensity[k]);
						let sky_weight = max(1.0, 4.0 * PI * sky_ambient);
						let sun_probability = sun_weight / (sun_weight + sky_weight);

						var new_direction = vec3f(0.0);
						if (uniform_float(&rng) > sun_probability) {
							new_direction = uniform_sphere(&rng);
							factor *= 4.0 * PI / (1.0 - sun_probability);
						} else {
							new_direction = uniform_spherical_cap(&rng, settings.sun_direction, settings.sun_radius);
							factor *= 2.0 * PI * (1.0 - cos(settings.sun_radius)) / sun_probability;
						}

						factor *= settings.scattering[k] * d * phase_function(ray.direction, new_direction) / (1.0 - roulette);

						ray.origin = p;
						ray.direction = new_direction;
						break;
					}
				}
			}
		}
	}

	var result = vec3f(0.0);
	result[k] = clamp(value, 0.0, settings.threshold);

    return vec4f(result, settings.alpha);
}