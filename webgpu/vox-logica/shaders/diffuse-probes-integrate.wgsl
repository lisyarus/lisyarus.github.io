struct EmissiveFace
{
	voxel: vec3i,
	side: u32,
}

struct EmissiveFaces
{
    count: u32,
    unused1: u32,
    unused2: u32,
    unused3: u32,
    faces: array<EmissiveFace>,
}

@group(0) @binding(0) var<storage, read> voxelTypes : array<u32, 256>;
@group(0) @binding(1) var voxelsTexture : texture_3d<u32>;
@group(0) @binding(2) var<storage, read_write> voxelProbeIndex : array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> emissiveFaces: EmissiveFaces;

%include probes.wgsl

@group(1) @binding(0) var<storage, read_write> diffuseProbesCount: atomic<u32>;
@group(1) @binding(1) var<storage, read_write> diffuseProbes: array<DiffuseProbe>;
@group(1) @binding(2) var<storage, read_write> diffuseProbesFreeList: array<u32>;

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

    var origin = vec3f(probe.voxel) + vec3f(0.5);
    {
	    let randomOffset = randomCube(&randomGenerator) - vec3f(0.5);
	    origin += randomOffset * 0.98;
	}

	// Found by trial and error
    const DIRECT_LIGHT_SAMPLING_PROBABILITY = 1.0 / 8.0;
    let useDirectLightSampling = emissiveFaces.count > 0u;

    var direction = vec3f(0.0);

    if (!useDirectLightSampling || random(&randomGenerator) > DIRECT_LIGHT_SAMPLING_PROBABILITY) {
        direction = randomSphere(&randomGenerator);
    } else {
        let face = emissiveFaces.faces[randomUint(&randomGenerator) % emissiveFaces.count];
        let normal = SIDE_NORMALS[face.side];
        var randomOffset = randomCube(&randomGenerator) - vec3f(0.5);
        randomOffset -= normal * dot(randomOffset, normal);
        let point = vec3f(face.voxel) + vec3f(0.5) + 0.5 * normal + randomOffset;
        direction = normalize(point - origin);
    }

    let ray = Ray(origin, direction);

    var rayColor = vec3f(0.0);

    let raytraceResult = raytraceScene(ray, voxelsTexture, true);

    let directionProbability = select(
        1.0 / (4.0 * PI),
        (1.0 - DIRECT_LIGHT_SAMPLING_PROBABILITY) / (4.0 * PI) + DIRECT_LIGHT_SAMPLING_PROBABILITY * raytraceResult.emissiveSamplingProbability / f32(emissiveFaces.count),
        useDirectLightSampling
    );

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
    if (directionProbability > 1e-8) {
        rayColor /= directionProbability;
    } else {
        // Oh no! Anyway,
        rayColor = vec3f(0.0);
    }

    // Somehow doing it in getProbeIndex leaves uninitialized data :/
    if (probe.state == 0u) {
        probe.colorR = vec4f(0.0);
        probe.colorG = vec4f(0.0);
        probe.colorB = vec4f(0.0);
    }

    probe.state += 1u;

    let mu = select(DIFFUSE_PROBE_LEARNING_RATE, 1.0 / f32(probe.state), FULL_CONVERGE);

    let directionSH = evalSH1(direction);
    probe.colorR = mix(probe.colorR, rayColor.r * directionSH, mu);
    probe.colorG = mix(probe.colorG, rayColor.g * directionSH, mu);
    probe.colorB = mix(probe.colorB, rayColor.b * directionSH, mu);

    diffuseProbes[id.x] = probe;
}