@group(0) @binding(0) var<storage, read> voxelTypes : array<u32, 256>;
@group(0) @binding(1) var voxelsTexture : texture_3d<u32>;
@group(0) @binding(2) var<storage, read_write> voxelProbeIndex : array<atomic<u32>>;

%include probes.wgsl

@group(1) @binding(0) var<storage, read_write> diffuseProbesCount: atomic<u32>;
@group(1) @binding(1) var<storage, read_write> diffuseProbes: array<DiffuseProbe>;
@group(1) @binding(2) var<storage, read_write> diffuseProbesFreeList: array<u32>;

%include uniforms.wgsl

@group(2) @binding(0) var<uniform> uniforms : RenderUniforms;

%include fullscreen.wgsl
%include raytrace.wgsl
%include voxel-data.wgsl
%include probe-allocate.wgsl
%include spherical-harmonics.wgsl

@fragment
fn fragmentMain(in : VertexOut) -> @location(0) vec4f
{
    var ray = Ray(uniforms.cameraPosition, normalize(in.nearPlanePosition - uniforms.cameraPosition));

    let raytraceResult = raytraceScene(ray, voxelsTexture, false);
    if (!raytraceResult.intersected) {
    	return vec4f(uniforms.skyColor, 1.0);
    }

    let voxelData = unpackVoxelData(voxelTypes[textureLoad(voxelsTexture, raytraceResult.voxel, 0).r]);

    if (voxelData.mode == VOXEL_DIFFUSE) {
    	let probeVoxel = raytraceResult.voxel + SIDE_NEIGHBOURS[raytraceResult.side];
	    let probeIndex = getProbeIndex(probeVoxel);

	    if (probeIndex == NULL_INDEX) {
	    	return vec4f(0.0, 0.0, 0.0, 1.0);
	    }

	    return vec4f(diffuseColor(&diffuseProbes[probeIndex], voxelData.albedo, SIDE_NORMALS[raytraceResult.side]), 1.0);
    }
    else if (voxelData.mode == VOXEL_EMISSIVE) {
	    return vec4f(voxelData.emission, 1.0);
    }

    return vec4f(1.0, 0.0, 1.0, 1.0);
}