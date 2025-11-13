@group(0) @binding(0) var<storage, read> voxelTypes : array<u32, 256>;
@group(0) @binding(1) var voxelsTexture : texture_3d<u32>;

%include probes.wgsl

@group(1) @binding(0) var<storage, read_write> diffuseProbeCount: atomic<u32>;
@group(1) @binding(1) var<storage, read_write> diffuseProbes: array<ConcurrentDiffuseProbe>;

%include uniforms.wgsl

@group(2) @binding(0) var<uniform> uniforms : RenderUniforms;

%include fullscreen.wgsl
%include raytrace.wgsl
%include voxel-data.wgsl

@fragment
fn fragmentMain(in : VertexOut) -> @location(0) vec4f
{
    const skyColor = vec3f(0.005, 0.01, 0.03);

    var ray = Ray(uniforms.cameraPosition, normalize(in.nearPlanePosition - uniforms.cameraPosition));

    let result = raytraceScene(ray, voxelsTexture);
    if (!result.intersected) {
    	return vec4f(0.0, 0.0, 0.0, 1.0);
    }

    let probeID = getProbeID(result.voxel, result.side);
    var probeIndex = findDiffuseProbe(&diffuseProbes, probeID);
    if (probeIndex == NULL_INDEX) {
    	probeIndex = spawnDiffuseProbe(&diffuseProbes, &diffuseProbeCount, probeID);
		diffuseProbes[probeIndex].relevance = 0;
		diffuseProbes[probeIndex].colorR = 0.0;
		diffuseProbes[probeIndex].colorG = 0.0;
		diffuseProbes[probeIndex].colorB = 0.0;
		diffuseProbes[probeIndex].variance = 0.0;
    }

    if (probeIndex == NULL_INDEX) {
    	return vec4f(0.0, 0.0, 1.0, 1.0);
    }

    return vec4f(f32(probeIndex & 255) / 255.0, f32((probeIndex >> 8) & 255) / 255.0, f32((probeIndex >> 16) & 255) / 255.0, 1.0);
}