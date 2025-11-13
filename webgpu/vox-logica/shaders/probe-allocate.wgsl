%include probes.wgsl

fn getProbeIndex(voxel: vec3i, side: u32) -> u32
{
    let voxelIndex = voxel.x + 256 * (voxel.y + 256 * voxel.z);
    var probeBucketIndex = atomicLoad(&voxelProbeIndex[voxelIndex]);

    if (probeBucketIndex != NULL_INDEX) {
    	return 6u * probeBucketIndex + side;
    }

	let freeListIndex = atomicAdd(&diffuseProbesCount, 1u);
	let newProbeIndex = diffuseProbesFreeList[freeListIndex];
	while (true) {
		let compareExchangeResult = atomicCompareExchangeWeak(&voxelProbeIndex[voxelIndex], NULL_INDEX, newProbeIndex);
		if (compareExchangeResult.exchanged) {
			probeBucketIndex = newProbeIndex;
			break;
		} else if (compareExchangeResult.old_value != NULL_INDEX) {
			// Another thread spawned the probe
			// Return our probe to the recycle list
			diffuseProbesRecycleList[atomicAdd(&diffuseProbesRecycleCount, 1u)] = newProbeIndex;
			probeBucketIndex = compareExchangeResult.old_value;
			break;
		}
		// Otherwise, continue the CAS loop
	}

	let probeIndex = 6u * probeBucketIndex + side;

	var probe = DiffuseProbe();
	probe.voxel = voxel;
	probe.relevanceAndSide = side << 16;
	probe.color = vec3f(0.0);
	probe.alpha = 0.0;
	probe.variance = 0.0;
	probe.mu = 0.0;
	diffuseProbes[probeIndex] = probe;

	return probeIndex;
}