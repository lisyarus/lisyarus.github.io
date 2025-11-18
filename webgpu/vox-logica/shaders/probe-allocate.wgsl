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

    if (probeIndex < PENDING_PROBE) {
    	return probeIndex;
    }

	while (true) {
		let compareExchangeResult = atomicCompareExchangeWeak(&voxelProbeIndex[voxelIndex], NULL_INDEX, PENDING_PROBE);
		if (compareExchangeResult.exchanged) {
			let freeListIndex = atomicAdd(&diffuseProbesCount, 1u);
			probeIndex = diffuseProbesFreeList[freeListIndex];

			var probe = DiffuseProbe();
			probe.voxel = voxel;
			probe.state = USED_PROBE;
			probe.colorR = vec4f(0.0);
			probe.colorG = vec4f(0.0);
			probe.colorB = vec4f(0.0);
			diffuseProbes[probeIndex] = probe;

			atomicStore(&voxelProbeIndex[voxelIndex], probeIndex);

			break;
		} else if (compareExchangeResult.old_value < PENDING_PROBE) {
			// Another thread spawned the probe
			probeIndex = compareExchangeResult.old_value;
			break;
		} else if (compareExchangeResult.old_value == PENDING_PROBE) {
			// Do nothing - wait until another thread 
		}
		// Otherwise, continue the CAS loop
	}

	return probeIndex;
}