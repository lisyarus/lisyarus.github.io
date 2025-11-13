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

%include fullscreen.wgsl
%include raytrace.wgsl
%include voxel-data.wgsl
%include probe-allocate.wgsl

@fragment
fn fragmentMain(in : VertexOut) -> @location(0) vec4f
{
    var ray = Ray(uniforms.cameraPosition, normalize(in.nearPlanePosition - uniforms.cameraPosition));

    let result = raytraceScene(ray, voxelsTexture);
    if (!result.intersected) {
    	return vec4f(uniforms.skyColor, 1.0);
    }

    let voxelData = unpackVoxelData(voxelTypes[textureLoad(voxelsTexture, result.voxel, 0).r]);

    if (voxelData.mode == VOXEL_DIFFUSE) {
	    let probeIndex = getProbeIndex(result.voxel, result.side);

	    if (probeIndex == NULL_INDEX) {
	    	return vec4f(0.0, 0.0, 0.0, 1.0);
	    }

	    if (diffuseProbes[probeIndex].relevanceAndSide == EMPTY_PROBE) {
			diffuseProbes[probeIndex].voxel = result.voxel;
			diffuseProbes[probeIndex].relevanceAndSide = (result.side << 16);
			diffuseProbes[probeIndex].color = vec3f(0.0);
			diffuseProbes[probeIndex].alpha = 0.0;
			diffuseProbes[probeIndex].variance = 0.0;
			diffuseProbes[probeIndex].mu = 0.0;
	    }

	    if (diffuseProbes[probeIndex].alpha > 0.0) {
		    let color = diffuseProbes[probeIndex].color * voxelData.albedo / diffuseProbes[probeIndex].alpha;
		    return vec4f(color, 1.0);
	    } else {
	    	return vec4f(0.0, 0.0, 0.0, 1.0);
	    }
    }
    else if (voxelData.mode == VOXEL_EMISSIVE) {
	    return vec4f(voxelData.emission, 1.0);
    }

    return vec4f(1.0, 0.0, 1.0, 1.0);
}