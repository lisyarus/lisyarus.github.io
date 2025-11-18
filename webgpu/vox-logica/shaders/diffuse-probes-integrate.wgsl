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
%include probe-allocate.wgsl
%include spherical-harmonics.wgsl

@compute @workgroup_size(64)
fn integrateMain(@builtin(global_invocation_id) id: vec3u)
{
	if (id.x >= arrayLength(&diffuseProbes)) {
		return;
	}

	var probe = diffuseProbes[id.x];

	if (probe.state == EMPTY_PROBE) {
		return;
	}

    var randomGenerator = RandomGenerator(u32(probe.voxel.x));
    randomInit(&randomGenerator, u32(probe.voxel.y));
    randomInit(&randomGenerator, u32(probe.voxel.z));
    randomInit(&randomGenerator, uniforms.frameID);
    randomInit(&randomGenerator, 0x2f21b60du);

    let direction = randomSphere(&randomGenerator);
    var origin = vec3f(probe.voxel) + vec3f(0.5);
    {
	    var randomOffset = vec3f(random(&randomGenerator), random(&randomGenerator), random(&randomGenerator)) - vec3f(0.5);
	    origin += randomOffset*0.98;
	}
    let ray = Ray(origin, direction);

    var rayColor = vec3f(0.0);

    let raytraceResult = raytraceScene(ray, voxelsTexture);
    if (raytraceResult.intersected) {
    	let voxelData = unpackVoxelData(voxelTypes[textureLoad(voxelsTexture, raytraceResult.voxel, 0).r]);

	    if (voxelData.mode == VOXEL_DIFFUSE) {
	    	let probeVoxel = raytraceResult.voxel + SIDE_NEIGHBOURS[raytraceResult.side];
		    let probeIndex = getProbeIndex(probeVoxel);

		    if (probeIndex != NULL_INDEX) {
		    	rayColor = diffuseColor(&diffuseProbes[probeIndex], voxelData.albedo, SIDE_NORMALS[raytraceResult.side]);
	    	}
	    }
	    else if (voxelData.mode == VOXEL_EMISSIVE) {
		    rayColor = voxelData.emission;
	    }
    } else {
    	rayColor = uniforms.skyColor;
    }

    // Inverse direction probability for Monte-Carlo
    rayColor *= 4.0 * PI;

    probe.state += 1u;

    let mu = select(DIFFUSE_PROBE_LEARNING_RATE, 1.0 / f32(probe.state), FULL_CONVERGE);

    let directionSH = evalSH1(direction);
    probe.colorR = mix(probe.colorR, rayColor.r * directionSH, mu);
    probe.colorG = mix(probe.colorG, rayColor.g * directionSH, mu);
    probe.colorB = mix(probe.colorB, rayColor.b * directionSH, mu);

    diffuseProbes[id.x] = probe;
}