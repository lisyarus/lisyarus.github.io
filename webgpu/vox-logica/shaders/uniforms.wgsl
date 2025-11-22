struct RenderUniforms
{
    viewProjection: mat4x4f,
    viewProjectionInverse: mat4x4f,
    lastFrameViewProjection: mat4x4f,
    cameraPosition: vec3f,
    frameID: u32,
    skyColor: vec3f,
    padding1: u32,
    worldOrigin: vec3i,
    padding2: u32,
}