@group(0) @binding(0) var hdrTexture : texture_2d<f32>;
@group(0) @binding(1) var blueNoiseTexture : texture_2d<f32>;

const vertices = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f( 3.0, -1.0),
    vec2f(-1.0,  3.0),
);

struct VertexOut
{
    @builtin(position) position : vec4f,
    @location(0) texcoord : vec2f,
}

@vertex
fn vertexMain(@builtin(vertex_index) id : u32) -> VertexOut
{
    let vertex = vertices[id];
    return VertexOut(
        vec4f(vertex, 0.0, 1.0),
        vertex * 0.5 + vec2f(0.5)
    );
}

fn acesTonemap(x : vec3f) -> vec3f
{
    let a = 2.51;
    let b = 0.03;
    let c = 2.43;
    let d = 0.59;
    let e = 0.14;
    return clamp((x*(a*x+b))/(x*(c*x+d)+e), vec3f(0.0), vec3f(1.0));
}

fn maxTonemap(x : vec3f) -> vec3f
{
    let m = max(1.0, max(x.r, max(x.g, x.b)));
    return x / m;
}

fn uncharted2TonemapImpl(x : vec3f) -> vec3f
{
    let A = 0.15;
    let B = 0.50;
    let C = 0.10;
    let D = 0.20;
    let E = 0.02;
    let F = 0.30;

    return ((x*(A*x+C*B)+D*E)/(x*(A*x+B)+D*F))-E/F;
}

fn uncharted2Tonemap(x : vec3f) -> vec3f
{
    let exposure = 5.0;
    let white = 10.0;
    return uncharted2TonemapImpl(x * exposure) / uncharted2TonemapImpl(vec3f(white));
}

fn agxTonemap(x : vec3f) -> vec3f
{
    const M1 = mat3x3f(0.842, 0.0423, 0.0424, 0.0784, 0.878, 0.0784, 0.0792, 0.0792, 0.879);
    const M2 = mat3x3f(1.2, -0.053, -0.053, -0.1, 1.15, -0.1, -0.1, -0.1, 1.15);
    const c1 = 12.47393;
    const c2 = 16.5;

    var result = x * 0.5;
    result = M1 * result;
    result = clamp((log2(result) + c1) / c2, vec3f(0.0), vec3f(1.0));
    result = 0.5 + 0.5 * sin(((-3.11 * result + 6.42) * result - 0.378) * result - 1.44);
    result = M2 * result;

    return result;
}

fn dither(x : vec3f, n : f32) -> vec3f
{
    let c = x * 255.0;
    let c0 = floor(c);
    let c1 = c0 + vec3f(1.0);
    let dc = c - c0;

    var r = c0;
    if (dc.r > n) { r.r = c1.r; }
    if (dc.g > n) { r.g = c1.g; }
    if (dc.b > n) { r.b = c1.b; }

    return r / 255.0;
}

@fragment
fn fragmentMain(in : VertexOut) -> @location(0) vec4f
{
    var sample = textureLoad(hdrTexture, vec2i(in.position.xy), 0); 
    let noise = textureLoad(blueNoiseTexture, vec2u(in.position.xy) % textureDimensions(blueNoiseTexture), 0).r;

    var color = sample.rgb / sample.a;
    color = acesTonemap(color);
    color = pow(color, vec3f(1.0 / 2.2));
    color = dither(color, noise);

    return vec4f(color, 1.0);
}