struct ProbeID
{
	voxel: vec3i,
	side: u32,
}

const NULL_INDEX = 0xffffffffu;
const PENDING_PROBE = 0xfffffffeu;
const EMPTY_PROBE = 0u;
const USED_PROBE = 1u;

struct DiffuseProbe
{
	voxel: vec3i,
	state: u32,

	// Per-channel SH coefficients
	colorR: vec4f,
	colorG: vec4f,
	colorB: vec4f,
}
