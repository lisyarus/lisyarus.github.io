const FULLSCREEN_VERTICES = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f( 3.0, -1.0),
    vec2f(-1.0,  3.0),
);

struct VertexOut
{
    @builtin(position) position : vec4f,
    @location(0) nearPlanePosition : vec3f,
}

fn perspectiveDivide(v : vec4f) -> vec3f
{
    return v.xyz / v.w;
}

@vertex
fn vertexMain(@builtin(vertex_index) id : u32) -> VertexOut
{
    let vertex = FULLSCREEN_VERTICES[id];
    return VertexOut(
        vec4f(vertex, 0.0, 1.0),
        perspectiveDivide(uniforms.viewProjectionInverse * vec4f(vertex, -1.0, 1.0))
    );
}
