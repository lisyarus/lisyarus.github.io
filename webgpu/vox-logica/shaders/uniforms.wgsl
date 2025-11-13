struct RenderUniforms
{
    viewProjection: mat4x4f,
    viewProjectionInverse: mat4x4f,
    lastFrameViewProjection: mat4x4f,
    cameraPosition: vec3f,
    frameID: u32,
}