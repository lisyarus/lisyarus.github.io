struct ProbeID
{
	voxel: vec3i,
	side: u32,
}

const NULL_INDEX = 0xffffffffu;
const EMPTY_PROBE = 0xffffffffu;

struct DiffuseProbe
{
	voxel: vec3i,
	relevanceAndSide: u32, // low 16 bits - relevance, high 16 bits - side

	color: vec3f,
	alpha: f32,

	variance: f32,
	mu: f32, // learning speed
	padding1: u32,
	padding2: u32,
}
