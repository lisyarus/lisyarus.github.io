@group(0) @binding(0) var<storage, read_write> diffuseProbesCount: atomic<u32>;
@group(0) @binding(2) var<storage, read_write> diffuseProbesFreeList: array<u32>;
@group(0) @binding(3) var<storage, read_write> diffuseProbesRecycleCount: u32;
@group(0) @binding(4) var<storage, read_write> diffuseProbesRecycleList: array<u32>;

@group(1) @binding(0) var<storage, read_write> diffuseProbesRecycleWorkgroupCount: array<u32>;

@compute @workgroup_size(1)
fn recyclePrepare()
{
	diffuseProbesRecycleWorkgroupCount[0] = (diffuseProbesRecycleCount + 63u) / 64u;
	diffuseProbesRecycleWorkgroupCount[1] = 1u;
	diffuseProbesRecycleWorkgroupCount[2] = 1u;
}

@compute @workgroup_size(64)
fn recycleMain(@builtin(global_invocation_id) id: vec3u)
{
	if (id.x >= diffuseProbesRecycleCount) {
		return;
	}

	let probeIndex = diffuseProbesRecycleList[id.x];
	diffuseProbesFreeList[atomicSub(&diffuseProbesCount, 1u) - 1u] = probeIndex;
}