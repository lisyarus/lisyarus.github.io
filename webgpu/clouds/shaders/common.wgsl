struct Bbox {
    min: vec3f,
    max: vec3f,
}

struct Ray {
    origin: vec3f,
    direction: vec3f,
}

fn intersect_bbox(ray: Ray, bbox: Bbox, clip: bool) -> vec2f {
    let t0 = (bbox.min - ray.origin) / ray.direction;
    let t1 = (bbox.max - ray.origin) / ray.direction;

    var tmin = min(t0, t1);
    let tmax = max(t0, t1);

    if (clip) {
    	tmin = max(tmin, vec3f(0.0));
    }

    return vec2f(
        max(tmin.x, max(tmin.y, tmin.z)),
        min(tmax.x, min(tmax.y, tmax.z))
    );
}

fn luminance(color: vec3f) -> f32 {
    return dot(color, vec3f(0.2126, 0.7152, 0.0722));
}

const PI = 3.141592653589793;

fn henyey_greenstein(cos_theta: f32, g: f32) -> f32 {
    return (1.0 / 4.0 / PI) * (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cos_theta, 1.5);
}

fn pcg(n: u32) -> u32 {
    var h = n * 747796405u + 2891336453u;
    h = ((h >> ((h >> 28u) + 4u)) ^ h) * 277803737u;
    return (h >> 22u) ^ h;
}

struct RNGState {
    value : u32,
}

fn init_random(state: ptr<function, RNGState>, value : u32) {
    (*state).value ^= value;
    (*state).value = pcg((*state).value);
}
// Slightly biased if (2^32 % max) != 0
fn uniform_uint(state: ptr<function, RNGState>, max : u32) -> u32 {
    (*state).value = pcg((*state).value);
    return ((*state).value % max);
}

fn uniform_float(state: ptr<function, RNGState>) -> f32 {
    (*state).value = pcg((*state).value);
    return f32((*state).value) / 4294967295.0;
}

fn uniform_sphere(state: ptr<function, RNGState>) -> vec3f {
	let theta = acos(2.0 * uniform_float(state) - 1.0);
	let phi = 2.0 * PI * uniform_float(state);

	return sin(theta) * (cos(phi) * vec3f(1.0, 0.0, 0.0) + sin(phi) * vec3f(0.0, 1.0, 0.0)) + cos(theta) * vec3f(0.0, 0.0, 1.0);
}

fn uniform_spherical_cap(state: ptr<function, RNGState>, center: vec3f, angular_radius: f32) -> vec3f {
	let x = normalize(cross(center, select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), abs(center.x) > 0.5)));
	let y = cross(center, x);

	let u = uniform_float(state);
	let v = uniform_float(state);

	let phi = 2.0 * PI * v;
	let h = 1.0 - u * (1.0 - cos(angular_radius));

	return center * h + (x * cos(phi) + y * sin(phi)) * sqrt(max(0.0, 1.0 - h * h));
}

// The functions below assume a global `var settings: Settings`

fn sample_density(p: vec3f) -> f32 {
	let q = (p - settings.bbox_min) / (settings.bbox_max - settings.bbox_min);
	let v = textureSampleLevel(density, density_sampler, q, 0).r;
	return clamp((v - settings.remap_density.x) / (settings.remap_density.y - settings.remap_density.x), 0.0, 1.0);
}

fn cube3(x: vec3f) -> vec3f {
	return x * x * x;
}

fn bspline_weights(t: vec3f) -> mat4x3f {
	return mat4x3f(
		cube3(vec3f(1.0) - t),
		vec3f(4.0) + t * t * (- vec3f(6.0) + 3.0 * t),
		vec3f(1.0) + t * (vec3f(3.0) + t * (vec3f(3.0) - 3.0 * t)),
		cube3(t)
	) * (1.0 / 6.0);
}

fn sample_density_tricubic(p: vec3f, state: ptr<function, RNGState>) -> f32 {
	let size = vec3f(textureDimensions(density, 0));
	let q = (p - settings.bbox_min) / (settings.bbox_max - settings.bbox_min) * size;
	let c = floor(q);
	let t = q - c;
	let weights = bspline_weights(t);

	// Cubic b-spline interpolation computes a weighted sum
	// of A[-1], A[0], A[1] and A[2]. Here we do tricubic interpolation,
	// thus we need to interpolate between 4^3 = 64 texels.
	// We randomly select between pairs (A[-1], A[0]) and (A[1], A[2])
	// based on their weights (separately for X, Y, and Z), and
	// use hardware trilinear filtering to sample 8 texels at once
	// with correct weights. On average, this converges to the
	// required tricubic interpolation result.

	let pick = vec3f(uniform_float(state), uniform_float(state), uniform_float(state));

	let w01 = weights[0] + weights[1];
	let w23 = weights[2] + weights[3];

	let r01 = c - weights[0] / w01;
	let r23 = c + vec3f(1.0) + weights[3] / w23;

	let r = select(r01, r23, pick >= w01) / size;

	let v = textureSampleLevel(density, density_sampler, r, 0).r;

	return clamp((v - settings.remap_density.x) / (settings.remap_density.y - settings.remap_density.x), 0.0, 1.0);
}

fn phase_function(in: vec3f, out: vec3f) -> f32 {
	let d = dot(in, out);

	// Combine two HG lobes (one forward, one backward) as
	// a crude approximation to Mie phase function.
    return mix(henyey_greenstein(d, settings.lobe_1_g), henyey_greenstein(d, settings.lobe_2_g), settings.lobe_mix);
}

fn sqr(x: f32) -> f32 {
	return x * x;
}

fn sky_color(direction: vec3f) -> vec3f {
	let sky_t = sqrt(1.0 - sqr(1.0 - abs(direction.y)));
	let base_sky = select(
		mix(settings.horizon_color, settings.sky_color_0, sky_t),
		mix(settings.horizon_color, settings.sky_color_1, sky_t),
		direction.y > 0.0
	);

	let sun_angle = acos(clamp(dot(direction, settings.sun_direction), 0.0, 1.0));

	// Sun intensity is defined as total sun intensity, but here
	// we need intensity per solid angle, thus we divide by
	// visible sun area in steradians.
	let sun_area = 2.0 * PI * (1.0 - cos(settings.sun_radius));
	let sun = settings.sun_intensity / sun_area * smoothstep(0.005, -0.005, sun_angle - settings.sun_radius);

	let sun_glow = 0.0004 * settings.sun_intensity * select(0.0, 1.0 / (sun_angle - settings.sun_radius), sun_angle > settings.sun_radius);

	return base_sky + sun + sun_glow;
}