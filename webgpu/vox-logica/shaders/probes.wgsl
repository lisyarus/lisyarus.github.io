%include spherical-harmonics.wgsl

struct ProbeID
{
	voxel: vec3i,
	side: u32,
}

const NULL_INDEX = 0xffffffffu;
const PENDING_PROBE = 0xfffffffeu;
const EMPTY_PROBE = 0xffffffffu;

const DIFFUSE_PROBE_LEARNING_RATE = 1.0 / 256.0;

struct DiffuseProbe
{
	voxel: vec3i,
	state: u32, // EMPTY_PROBE or number of hits

	// Per-channel SH coefficients
	colorR: vec4f,
	colorG: vec4f,
	colorB: vec4f,
}

fn diffuseColor(probe: ptr<storage, DiffuseProbe, read_write>, albedo: vec3f, normal: vec3f) -> vec3f
{
	if ((*probe).state == 0u) {
		return vec3f(0.0);
	}

	let diffuseSH = diffuseFromSH1(normal);

	let color = vec3f(
		dot(diffuseSH, (*probe).colorR),
		dot(diffuseSH, (*probe).colorG),
		dot(diffuseSH, (*probe).colorB)
	);

	return color * albedo / PI / (1.0 - pow(1.0 - DIFFUSE_PROBE_LEARNING_RATE, f32((*probe).state)));
}