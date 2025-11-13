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

fn computeSide(n : vec3f) -> u32
{
    if (abs(n.x) > abs(n.y) && abs(n.x) > abs(n.z)) {
        if (n.x > 0.0) {
            return 1u;
        } else {
            return 0u;
        }
    } else if (abs(n.y) > abs(n.z)) {
        if (n.y > 0.0) {
            return 3u;
        } else {
            return 2u;
        }
    } else {
        if (n.z > 0.0) {
            return 5u;
        } else {
            return 4u;
        }
    }
}

struct RaytraceResult
{
    intersected: bool,
    voxel: vec3i,
    point: vec3f,
    side: u32, // -X, +X, -Y, +Y, -Z, +Z
}

const NO_INTERSECTION = RaytraceResult(false, vec3i(0), vec3f(0.0), 0u);

const SIDE_NORMALS = array<vec3f, 6>(
    vec3f(-1.0,  0.0,  0.0),
    vec3f( 1.0,  0.0,  0.0),
    vec3f( 0.0, -1.0,  0.0),
    vec3f( 0.0,  1.0,  0.0),
    vec3f( 0.0,  0.0, -1.0),
    vec3f( 0.0,  0.0,  1.0),
);

fn raytraceScene(ray : Ray, voxelsTexture: texture_3d<u32>) -> RaytraceResult
{
    let mapSize = vec3i(textureDimensions(voxelsTexture));

    let bbox = AABB(vec3f(0.0), vec3f(mapSize));

    var intersection = rayAABBIntersection(ray, bbox);

    if (intersection.min > intersection.max || intersection.max < 0.0) {
        return NO_INTERSECTION;
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
            return NO_INTERSECTION;
        }
    }

    let side = computeSide(position - (vec3f(cell) + vec3f(0.5)));

    return RaytraceResult(true, cell, position, side);
}
