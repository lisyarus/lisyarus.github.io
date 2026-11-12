@group(0) @binding(0) var hdr: texture_2d<f32>;

@group(1) @binding(0) var<storage, read_write> output: array<u32>;

@compute @workgroup_size(8, 8)
fn compute_main(@builtin(global_invocation_id) index: vec3u) {
	let size = textureDimensions(hdr, 0).xy;
	if (any(index.xy >= size)) {
		return;
	}

	let pixel = clamp(textureLoad(hdr, index.xy, 0).rgb, vec3f(0.0), vec3f(65408.0));
	let m = max(pixel.r, max(pixel.g, pixel.b));

	var result = 0u;
	if (m >= 1e-32) {
		var e = ceil(log2(m));

		if (exp2(e) <= m) {
			e += 1.0;
		}

		let scale = 256.0 * exp2(-e);

		let mantissa = vec3u(pixel * scale);
		let exponent = u32(e + 128.0);

		result = mantissa.r | (mantissa.g << 8u) | (mantissa.b << 16u) | (exponent << 24u);
	}

	output[index.y * size.x + index.x] = result;
}