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

    for (var bounce = 0u; bounce < 1u; bounce += 1u) {
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
        accumulated = pow(vec3f(0.5 + 0.5 * dot(normal, normalize(vec3f(1.0, 4.0, 7.0)))), vec3f(2.2));
        //accumulated = mix(vec3f(select(0.0, 0.2, result.intersected), 0.0, select(0.0, 1.0, result.intersected)), vec3f(1.0, 0.25, 0.0), f32(result.steps) / 256.0);

        let newDirection = randomCosineHemisphere(&randomGenerator, normal);
        ray = Ray(result.point + newDirection * 0.01, newDirection);
    }

    return vec4f(accumulated, 1.0 / 1.0);
}