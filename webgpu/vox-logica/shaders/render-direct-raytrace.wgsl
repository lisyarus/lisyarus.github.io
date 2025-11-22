%include uniforms.wgsl

@group(0) @binding(0) var<storage, read> voxelTypes : array<u32, 256>;
@group(0) @binding(1) var chunksDataAtlas : texture_3d<u32>;
@group(0) @binding(2) var chunks : texture_3d<u32>;

@group(1) @binding(0) var<uniform> uniforms : RenderUniforms;

%include fullscreen.wgsl
%include raytrace.wgsl
%include voxel-data.wgsl
%include random.wgsl

@fragment
fn fragmentMain(in : VertexOut) -> @location(0) vec4f
{
    var randomGenerator = RandomGenerator(u32(in.position.x));
    randomInit(&randomGenerator, u32(in.position.y));
    randomInit(&randomGenerator, uniforms.frameID);
    randomInit(&randomGenerator, 0x2f21b60du);

    var ray = Ray(uniforms.cameraPosition, normalize(in.nearPlanePosition - uniforms.cameraPosition));

    var accumulated = vec3f(0.0);
    var factor = vec3f(1.0);

    for (var bounce = 0u; bounce < 2u; bounce += 1u) {
        let result = raytraceScene(ray, uniforms.worldOrigin, chunksDataAtlas, chunks);
        if (!result.intersected) {
            accumulated += factor * uniforms.skyColor;
            break;
        }

        let data = unpackVoxelData(voxelTypes[result.voxelType]);
        accumulated += factor * data.emission;
        factor *= data.albedo;

        let normal = SIDE_NORMALS[result.side];
        //accumulated = pow(normal * 0.5 + vec3f(0.5), vec3f(2.2));
        //accumulated = vec3f(result.voxel) / 16.0;

        let newDirection = randomCosineHemisphere(&randomGenerator, normal);
        ray = Ray(result.point + newDirection * 0.01, newDirection);
    }

    return vec4f(accumulated, 1.0 / 16.0);
}