@group(0) @binding(0) var<storage, read> voxelTypes : array<u32, 256>;
@group(0) @binding(1) var voxelsTexture : texture_3d<u32>;

struct Uniforms
{
    viewProjection: mat4x4f,
    viewProjectionInverse: mat4x4f,
    lastFrameViewProjection: mat4x4f,
    cameraPosition: vec3f,
    frameID: u32,
}

@group(1) @binding(0) var<uniform> uniforms : Uniforms;

const vertices = array<vec2f, 3>(
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
    let vertex = vertices[id];
    return VertexOut(
        vec4f(vertex, 0.0, 1.0),
        perspectiveDivide(uniforms.viewProjectionInverse * vec4f(vertex, -1.0, 1.0))
    );
}

struct Ray
{
    origin: vec3f,
    direction: vec3f,
}

struct AABB
{
    min: vec3f,
    max: vec3f,
}

struct Interval
{
    min: f32,
    max: f32,
}

fn rayAABBIntersection(ray : Ray, aabb : AABB) -> Interval
{
    var tmin = (aabb.min - ray.origin) / ray.direction;
    var tmax = (aabb.max - ray.origin) / ray.direction;

    if (ray.direction.x < 0.0) {
        let temp = tmin.x;
        tmin.x = tmax.x;
        tmax.x = temp;
    }

    if (ray.direction.y < 0.0) {
        let temp = tmin.y;
        tmin.y = tmax.y;
        tmax.y = temp;
    }

    if (ray.direction.z < 0.0) {
        let temp = tmin.z;
        tmin.z = tmax.z;
        tmax.z = temp;
    }

    return Interval(
        max(tmin.x, max(tmin.y, tmin.z)),
        min(tmax.x, min(tmax.y, tmax.z)),
    );
}

fn computeNormal(n : vec3f) -> vec3f
{
    if (abs(n.x) > abs(n.y) && abs(n.x) > abs(n.z)) {
        return vec3f(sign(n.x), 0.0, 0.0);
    } else if (abs(n.y) > abs(n.z)) {
        return vec3f(0.0, sign(n.y), 0.0);
    } else {
        return vec3f(0.0, 0.0, sign(n.z));
    }
}

struct RaytraceResult
{
    intersected: bool,
    voxel: vec3i,
    point: vec3f,
    normal: vec3f,
}

fn raytraceScene(ray : Ray) -> RaytraceResult
{
    let mapSize = vec3i(textureDimensions(voxelsTexture));

    let bbox = AABB(vec3f(0.0), vec3f(mapSize));

    var intersection = rayAABBIntersection(ray, bbox);

    if (intersection.min > intersection.max || intersection.max < 0.0) {
        return RaytraceResult(false, vec3i(0), vec3f(0.0), vec3f(0.0));
    }

    intersection.min = max(intersection.min, 0.0);

    var position = ray.origin + ray.direction * intersection.min;
    var cell = max(vec3i(0), min(vec3i(floor(position)), mapSize - vec3i(1)));
    var voxelType = 0u;
    var steps = 1u;

    while (true)
    {
        voxelType = textureLoad(voxelsTexture, cell, 0).r;
        if (voxelType != 0u) {
            break;
        }
        steps += 1u;

        let t = (select(vec3f(0.0), vec3f(1.0), ray.direction > vec3f(0.0)) + vec3f(cell) - position) / ray.direction;

        if (t.x < t.y && t.x < t.z) {
            position += ray.direction * t.x;
            cell.x += select(-1, 1, ray.direction.x > 0.0);
        } else if (t.y < t.z) {
            position += ray.direction * t.y;
            cell.y += select(-1, 1, ray.direction.y > 0.0);
        } else {
            position += ray.direction * t.z;
            cell.z += select(-1, 1, ray.direction.z > 0.0);
        }

        if (any(cell < vec3i(0)) || any(cell >= vec3i(mapSize)) || (ray.direction.z > 0.0 && cell.z > 136)) {
            return RaytraceResult(false, vec3i(0), vec3f(0.0), vec3f(0.0));
        }
    }

    let normal = computeNormal(position - (vec3f(cell) + vec3f(0.5)));

    return RaytraceResult(true, cell, position, normal);
}

struct VoxelData
{
    albedo: vec3f,
    emission: vec3f,
}

fn unpackVoxelData(data: u32) -> VoxelData
{
    let baseColor = vec3f(vec3u(data & 255u, (data >> 8) & 255u, (data >> 16) & 255u)) / 255.0;
    let mode = data >> 24;

    if (mode == 0u) {
        return VoxelData(baseColor, vec3f(0.0));
    } else {
        return VoxelData(vec3f(0.0), 8.0 * baseColor);
    }
}

struct RandomGenerator
{
    state: u32,
}

fn rotl32(x: u32, r: u32) -> u32
{
    return (x << r) | (x >> (32 - r));
}

fn hashCombine(x: u32, y: u32) -> u32
{
   const c1 = 0xcc9e2d51u;
   const c2 = 0x1b873593u;
   const c3 = 0xe6546b64u;

   var k1 = x;
   k1 *= c1;
   k1 = rotl32(k1, 15);
   k1 *= c2;

   var h1 = y ^ k1;
   h1 = rotl32(h1, 13);
   h1 = h1 * 5 + c3;

   return h1;
}

fn randomInit(gen: ptr<function, RandomGenerator>, value: u32)
{
    var x = (*gen).state;
    x = hashCombine(x, value);
    (*gen).state = x;
}

fn random(gen: ptr<function, RandomGenerator>) -> f32
{
    var x = (*gen).state;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    (*gen).state = x;
    return f32(x) / 4294967295.0;
}

const PI = 3.141592653589793;

fn randomSphere(gen: ptr<function, RandomGenerator>) -> vec3f
{
    let phi = 2.0 * PI * random(gen);
    let cosTheta = 2.0 * random(gen) - 1.0;
    let sinTheta = sin(acos(cosTheta));

    return vec3f(sinTheta * cos(phi), sinTheta * sin(phi), cosTheta);
}

@fragment
fn fragmentMain(in : VertexOut) -> @location(0) vec4f
{
    var randomGenerator = RandomGenerator(0x2f21b60du);
    randomInit(&randomGenerator, u32(in.position.x));
    randomInit(&randomGenerator, u32(in.position.y));
    randomInit(&randomGenerator, uniforms.frameID);

    const skyColor = vec3f(0.005, 0.01, 0.03);

    var ray = Ray(uniforms.cameraPosition, normalize(in.nearPlanePosition - uniforms.cameraPosition));

    var accumulated = vec3f(0.0);
    var factor = vec3f(1.0);

    for (var bounce = 0u; bounce < 4u; bounce += 1u) {
        let result = raytraceScene(ray);
        if (!result.intersected) {
            accumulated += factor * skyColor;
            break;
        }

        let data = unpackVoxelData(voxelTypes[textureLoad(voxelsTexture, result.voxel, 0).r]);
        accumulated += factor * data.emission;
        factor *= data.albedo;

        let newDirection = normalize(result.normal + randomSphere(&randomGenerator));
        ray = Ray(result.point + newDirection * 0.01, newDirection);
    }

    return vec4f(accumulated, 1.0 / 16.0);
}