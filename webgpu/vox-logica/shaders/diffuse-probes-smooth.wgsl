%include probes.wgsl

@group(0) @binding(2) var<storage, read_write> voxelProbeIndex : array<atomic<u32>>;

@group(1) @binding(1) var<storage, read_write> diffuseProbes: array<DiffuseProbe>;

fn findProbeIndex(voxel: vec3i, side: u32) -> u32
{
    let voxelIndex = voxel.x + 256 * (voxel.y + 256 * voxel.z);
    var probeBucketIndex = atomicLoad(&voxelProbeIndex[voxelIndex]);
    if (probeBucketIndex == NULL_INDEX) {
    	return NULL_INDEX;
    }
    return 6u * probeBucketIndex + side;
}

const VOXEL_NEIGHBOURS = array<vec3i, 6>(
	vec3i(-1,  0,  0),
	vec3i( 1,  0,  0),
	vec3i( 0, -1,  0),
	vec3i( 0,  1,  0),
	vec3i( 0,  0, -1),
	vec3i( 0,  0,  1),
);

@compute @workgroup_size(64)
fn smoothMain(@builtin(global_invocation_id) id: vec3u)
{
	if (id.x >= arrayLength(&diffuseProbes)) {
		return;
	}

	var probe = diffuseProbes[id.x];

	if (probe.relevanceAndSide == EMPTY_PROBE) {
		return;
	}

    let side = probe.relevanceAndSide >> 16;

	var neighbourSum = vec4f(0.0);
	var neighbourCount = 0u;

	for (var i = 0u; i < 6u; i += 1u) {
		var neighbour = probe.voxel + VOXEL_NEIGHBOURS[i];
		let probeIndex = findProbeIndex(neighbour, side);
		if (probeIndex == NULL_INDEX) {
			continue;
		}

		let probe = diffuseProbes[probeIndex];
		if (probe.relevanceAndSide == EMPTY_PROBE) {
			continue;
		}

		neighbourSum += vec4f(probe.color, 1.0) * probe.alpha;
		neighbourCount += 1u;
	}

	neighbourSum /= f32(neighbourCount);
	if (neighbourSum.a > 0.0) {
		let strength = 1.0 / 256.0;
		probe.color = mix(probe.color, neighbourSum.rgb / neighbourSum.a, strength);
		probe.alpha = mix(probe.alpha, neighbourSum.a, strength);
	}

    diffuseProbes[id.x] = probe;
}