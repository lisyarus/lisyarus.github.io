%include probes.wgsl

fn getProbeIndex(voxel: vec3i) -> u32
{
	if (any(voxel < vec3i(0)) || any(voxel >= vec3i(256))) {
		return NULL_INDEX;
	}

	if (textureLoad(voxelsTexture, voxel, 0).r != 0u) {
		return NULL_INDEX;
	}

    let voxelIndex = voxel.x + 256 * (voxel.y + 256 * voxel.z);
    var probeIndex = atomicLoad(&voxelProbeIndex[voxelIndex]);

    if (probeIndex != NULL_INDEX) {
    	return probeIndex;
    }

	let freeListIndex = atomicAdd(&diffuseProbesCount, 1u);
	let newProbeIndex = diffuseProbesFreeList[freeListIndex];
	while (true) {
		let compareExchangeResult = atomicCompareExchangeWeak(&voxelProbeIndex[voxelIndex], NULL_INDEX, newProbeIndex);
		if (compareExchangeResult.exchanged) {
			probeIndex = newProbeIndex;
			break;
		} else if (compareExchangeResult.old_value != NULL_INDEX) {
			// Another thread spawned the probe
			// Return our probe to the recycle list
			diffuseProbesRecycleList[atomicAdd(&diffuseProbesRecycleCount, 1u)] = newProbeIndex;
			probeIndex = compareExchangeResult.old_value;
			break;
		}
		// Otherwise, continue the CAS loop
	}

	var probe = DiffuseProbe();
	probe.voxel = voxel;
	probe.state = USED_PROBE;
	probe.colorR = vec4f(0.0);
	probe.colorG = vec4f(0.0);
	probe.colorB = vec4f(0.0);
	diffuseProbes[probeIndex] = probe;

	return probeIndex;
}