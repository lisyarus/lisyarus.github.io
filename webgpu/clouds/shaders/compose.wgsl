@group(0) @binding(0) var<uniform> settings: Settings;

@group(1) @binding(0) var hdr: texture_2d<f32>;
@group(1) @binding(1) var hdrSampler: sampler;

@group(2) @binding(0) var blue_noise: texture_2d<f32>;
@group(2) @binding(1) var blue_noise_sampler: sampler;
@group(2) @binding(2) var tony_mc_mapface_lut: texture_3d<f32>;
@group(2) @binding(3) var tony_mc_mapface_lut_sampler: sampler;

const VERTICES = array<vec2f, 3>(
	vec2f(-1.0, -1.0),
	vec2f( 3.0, -1.0),
	vec2f(-1.0,  3.0),
);

struct VertexOut {
	@builtin(position) position: vec4f,
	@location(0) texcoord: vec2f,
}

@vertex
fn vertex_main(@builtin(vertex_index) id: u32) -> VertexOut {
	let vertex = VERTICES[id];

	return VertexOut(
		vec4f(vertex, 0.0, 1.0),
		0.5 + vec2f(0.5, -0.5) * vertex
	);
}

fn tonemap_exp(color: vec3f) -> vec3f {
	return vec3f(1.0) - exp(- 2.0 * color * color);
}

fn tonemap_reinhard(color: vec3f) -> vec3f {
	return color / (vec3f(1.0) + color);
}

fn tonemap_aces(color: vec3f) -> vec3f {
    const A = vec3f(2.51);
    const B = vec3f(0.03);
    const C = vec3f(2.43);
    const D = vec3f(0.59);
    const E = vec3f(0.14);

    return saturate((color * (A * color + B)) / (color * (C * color + D) + E));
}

fn tonemap_uncharted_impl(color: vec3f) -> vec3f {
	const A = vec3f(0.15);
	const B = vec3f(0.50);
	const C = vec3f(0.10);
	const D = vec3f(0.20);
	const E = vec3f(0.02);
	const F = vec3f(0.30);

    return ((color * (A * color + C * B) + D * E) / (color * (A * color + B) + D * F)) - E / F;
}

fn tonemap_uncharted(color: vec3f) -> vec3f {
	const WHITE = vec3f(4.0);
	return tonemap_uncharted_impl(color) * (vec3f(1.0) / tonemap_uncharted_impl(WHITE));
}

fn agx_sigmoid(x: vec3f) -> vec3f {
	const A0 = vec3f(0.002857);
	const A1 = - 0.1718;
	const A2 = 4.361;
	const A3 = - 28.72;
	const A4 = 92.06;
	const A5 = - 126.7;
	const A6 = 78.01;
	const A7 = - 17.86;

	let x2 = x * x;
	let x4 = x2 * x2;
	let x6 = x4 * x2;

	return 
		  A7 * x6 * x
		+ A6 * x6
		+ A5 * x4 * x
		+ A4 * x4
		+ A3 * x2 * x
		+ A2 * x2
		+ A1 * x
		+ A0;
}

fn tonemap_agx(color: vec3f) -> vec3f {
	const SRGB_TO_REC2020 = mat3x3f(
	  0.6274, 0.0691, 0.0164,
	  0.3293, 0.9195, 0.0880,
	  0.0433, 0.0113, 0.8956
	);

	const REC2020_TO_SRGB = mat3x3f(
	   1.6605, -0.1246, -0.0182,
	  -0.5876,  1.1329, -0.1006,
	  -0.0728, -0.0083,  1.1187
	);

	const AGX_INSET = mat3x3f(
	  0.8566271533, 0.1373189729, 0.1118982130,
	  0.0951212405, 0.7612419906, 0.0767994186,
	  0.0482516061, 0.1014390365, 0.8113023684
	);

	const AGX_OUTSET = mat3x3f(
	   1.1271005818, -0.1413297635, -0.1413297635,
	  -0.1106066431,  1.1578237022, -0.1106066431,
	  -0.0164939387, -0.0164939387,  1.2519364066
	);

    const MIN_EV = vec3f(-12.47393 );
    const MAX_EV = vec3f(  4.026069);

    var val = SRGB_TO_REC2020 * color;

    val = AGX_INSET * val;
    val = clamp(log2(max(val, vec3f(1e-10))), MIN_EV, MAX_EV);
    val = (val - MIN_EV) / (MAX_EV - MIN_EV);
    val = agx_sigmoid(val);
    val = AGX_OUTSET * val;
    val = pow(max(val, vec3f(0.0)), vec3(2.2));

    val = REC2020_TO_SRGB * val;

    return max(val, vec3f(0.0));
}

fn tonemap_tony_mc_mapface(color: vec3f) -> vec3f {
    let encoded = color / (color + 1.0);

    const LUT_DIMS = 48.0;
    let uv = encoded * ((LUT_DIMS - 1.0) / LUT_DIMS) + vec3f(0.5 / LUT_DIMS);

    return textureSampleLevel(tony_mc_mapface_lut, tony_mc_mapface_lut_sampler, uv, 0).rgb;
}

fn dither(color: vec3f, max: f32, noise: f32) -> vec3f {
	let x = color * max;
	let i = floor(x);
	let t = x - i;
	let y = select(vec3f(0.0), vec3f(1.0), t > vec3f(noise));
	return (i + y) / max;
}

@fragment
fn fragment_main(in: VertexOut) -> @location(0) vec4f {
	let raw_color = textureSampleLevel(hdr, hdrSampler, in.texcoord, 0).rgb * settings.exposure;

	var tonemapped_color = raw_color;
	if (settings.tonemapping == 0u) {
		tonemapped_color = tonemap_exp(raw_color);
	} else if (settings.tonemapping == 1u) {
		tonemapped_color = tonemap_reinhard(raw_color);
	} else if (settings.tonemapping == 2u) {
		tonemapped_color = tonemap_aces(raw_color);
	} else if (settings.tonemapping == 3u) {
		tonemapped_color = tonemap_uncharted(raw_color);
	} else if (settings.tonemapping == 4u) {
		tonemapped_color = tonemap_agx(raw_color);
	} else if (settings.tonemapping == 5u) {
		tonemapped_color = tonemap_tony_mc_mapface(raw_color);
	}

	let gamma_corrected_color = pow(tonemapped_color, vec3f(1.0 / 2.2));

	let noise = textureSampleLevel(blue_noise, blue_noise_sampler, in.position.xy / vec2f(textureDimensions(blue_noise, 0)), 0).r;
	let dithered_color = dither(gamma_corrected_color, 255.0, noise);

	return vec4f(dithered_color, 1.0);
}