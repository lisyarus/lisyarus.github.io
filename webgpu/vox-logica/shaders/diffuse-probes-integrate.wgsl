@group(0) @binding(0) var<storage, read> voxelTypes : array<u32, 256>;
@group(0) @binding(1) var voxelsTexture : texture_3d<u32>;
@group(0) @binding(2) var<storage, read_write> voxelProbeIndex : array<atomic<u32>>;

%include probes.wgsl

@group(1) @binding(0) var<storage, read_write> diffuseProbesCount: atomic<u32>;
@group(1) @binding(1) var<storage, read_write> diffuseProbes: array<DiffuseProbe>;
@group(1) @binding(2) var<storage, read_write> diffuseProbesFreeList: array<u32>;
@group(1) @binding(3) var<storage, read_write> diffuseProbesRecycleCount: atomic<u32>;
@group(1) @binding(4) var<storage, read_write> diffuseProbesRecycleList: array<u32>;

%include uniforms.wgsl

@group(2) @binding(0) var<uniform> uniforms : RenderUniforms;

%include random.wgsl
%include raytrace.wgsl
%include voxel-data.wgsl

fn getProbeIndex(voxel: vec3i, side: u32) -> u32
{
    let voxelIndex = voxel.x + 256 * (voxel.y + 256 * voxel.z);
    var probeBucketIndex = atomicLoad(&voxelProbeIndex[voxelIndex]);
    if (probeBucketIndex == NULL_INDEX) {
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
    }

    if (probeBucketIndex == NULL_INDEX) {
    	return NULL_INDEX;
    }

    return 6u * probeBucketIndex + side;
}

@compute @workgroup_size(64)
fn integrateMain(@builtin(global_invocation_id) id: vec3u)
{
    //const skyColor = vec3f(0.005, 0.01, 0.03);
    const skyColor = vec3f(0.01, 0.02, 0.04);

	if (id.x >= arrayLength(&diffuseProbes)) {
		return;
	}

	var probe = diffuseProbes[id.x];

	if (probe.relevanceAndSide == EMPTY_PROBE) {
		return;
	}

    var randomGenerator = RandomGenerator(u32(probe.voxel.x));
    randomInit(&randomGenerator, u32(probe.voxel.y));
    randomInit(&randomGenerator, u32(probe.voxel.z));
    randomInit(&randomGenerator, uniforms.frameID);
    randomInit(&randomGenerator, 0x2f21b60du);

    let side = probe.relevanceAndSide >> 16;
    let normal = SIDE_NORMALS[side];
    let direction = randomCosineHemisphere(&randomGenerator, normal);
    var origin = vec3f(probe.voxel) + vec3f(0.5) + normal * 0.5;
    {
	    var randomOffset = vec3f(random(&randomGenerator), random(&randomGenerator), random(&randomGenerator)) - vec3f(0.5);
	    randomOffset -= normal * dot(randomOffset, normal);
	    origin += randomOffset*0.98;
	}
    let ray = Ray(origin + normal * 0.01, direction);

    var rayColor = vec3f(0.0);

    let raytraceResult = raytraceScene(ray, voxelsTexture);
    if (raytraceResult.intersected) {
    	let voxelData = unpackVoxelData(voxelTypes[textureLoad(voxelsTexture, raytraceResult.voxel, 0).r]);

	    if (voxelData.mode == VOXEL_DIFFUSE) {
		    let probeIndex = getProbeIndex(raytraceResult.voxel, raytraceResult.side);

		    if (probeIndex != NULL_INDEX) {
			    if (diffuseProbes[probeIndex].relevanceAndSide == EMPTY_PROBE) {
					diffuseProbes[probeIndex].voxel = raytraceResult.voxel;
					diffuseProbes[probeIndex].relevanceAndSide = (raytraceResult.side << 16);
					diffuseProbes[probeIndex].color = vec3f(0.0);
					diffuseProbes[probeIndex].alpha = 0.0;
					diffuseProbes[probeIndex].variance = 0.0;
					diffuseProbes[probeIndex].iterations = 0u;
			    }

			    if (diffuseProbes[probeIndex].alpha > 0.0) {
			    	rayColor = diffuseProbes[probeIndex].color * voxelData.albedo / diffuseProbes[probeIndex].alpha;
			    	if (any(min(rayColor, vec3f(10000.0)) == vec3f(10000.0))) {
			    		rayColor = vec3f(0.0);
			    	}
			    }
	    	}
	    }
	    else if (voxelData.mode == VOXEL_EMISSIVE) {
		    rayColor = voxelData.emission;
	    }
    } else {
    	rayColor = skyColor;
    }

    probe.iterations += 1u;

    let alpha = 1.0 / f32(probe.iterations);
    probe.color = mix(probe.color, rayColor, alpha);
    probe.alpha = mix(probe.alpha, 1.0, alpha);

    diffuseProbes[id.x] = probe;
}