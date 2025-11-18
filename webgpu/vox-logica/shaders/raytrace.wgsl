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

struct RayAABBIntersectionResult
{
    range: Interval,
    side: u32,
}

fn rayAABBIntersection(ray : Ray, aabb : AABB) -> RayAABBIntersectionResult
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

    let range = Interval(
        max(tmin.x, max(tmin.y, tmin.z)),
        min(tmax.x, min(tmax.y, tmax.z)),
    );

    var side = 0u;
    if (range.min == tmin.x) {
        side = select(0u, 1u, ray.direction.x < 0.0);
    } else if (range.min == tmin.y) {
        side = select(2u, 3u, ray.direction.y < 0.0);
    } else {
        side = select(4u, 5u, ray.direction.z < 0.0);
    }

    return RayAABBIntersectionResult(range, side);
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
    emissiveSamplingProbability: f32,
}

const NO_INTERSECTION = RaytraceResult(false, vec3i(0), vec3f(0.0), 0u, 0.0);

const SIDE_NEIGHBOURS = array<vec3i, 6>(
    vec3i(-1,  0,  0),
    vec3i( 1,  0,  0),
    vec3i( 0, -1,  0),
    vec3i( 0,  1,  0),
    vec3i( 0,  0, -1),
    vec3i( 0,  0,  1),
);

const SIDE_NORMALS = array<vec3f, 6>(
    vec3f(-1.0,  0.0,  0.0),
    vec3f( 1.0,  0.0,  0.0),
    vec3f( 0.0, -1.0,  0.0),
    vec3f( 0.0,  1.0,  0.0),
    vec3f( 0.0,  0.0, -1.0),
    vec3f( 0.0,  0.0,  1.0),
);

fn raytraceScene(ray : Ray, voxelsTexture: texture_3d<u32>, computeEmissiveSamplingProbability: bool) -> RaytraceResult
{
    let mapSize = vec3i(textureDimensions(voxelsTexture));

    let bbox = AABB(vec3f(0.0), vec3f(mapSize));

    var intersection = rayAABBIntersection(ray, bbox);

    if (intersection.range.min > intersection.range.max || intersection.range.max < 0.0) {
        return NO_INTERSECTION;
    }

    intersection.range.min = max(intersection.range.min, 0.0);

    var position = ray.origin + ray.direction * intersection.range.min;
    var cell = max(vec3i(0), min(vec3i(floor(position)), mapSize - vec3i(1)));
    var side = intersection.side;
    var lastVoxelType = 0u;
    var emissiveSamplingProbability = 0.0;

    var result = NO_INTERSECTION;

    while (true)
    {
        let voxelType = textureLoad(voxelsTexture, cell, 0).r;
        if (voxelType != 0u && !result.intersected) {
            result = RaytraceResult(true, cell, position, side, 0.0);
            if (!computeEmissiveSamplingProbability) {
                break;
            }
        }

        if (computeEmissiveSamplingProbability) {
            if (voxelType != 0u && lastVoxelType == 0u) {
                let voxelData = unpackVoxelData(voxelTypes[voxelType]);
                if (voxelData.mode == VOXEL_EMISSIVE) {
                    let delta = position - ray.origin;
                    emissiveSamplingProbability += dot(delta, delta) / max(1e-8, abs(dot(ray.direction, SIDE_NORMALS[side])));
                }
            }

            if (voxelType == 0u && lastVoxelType != 0u) {
                let voxelData = unpackVoxelData(voxelTypes[lastVoxelType]);
                if (voxelData.mode == VOXEL_EMISSIVE) {
                    let delta = position - ray.origin;
                    emissiveSamplingProbability += dot(delta, delta) / max(1e-8, abs(dot(ray.direction, SIDE_NORMALS[side])));
                }
            }
        }

        lastVoxelType = voxelType;

        let t = (select(vec3f(0.0), vec3f(1.0), ray.direction > vec3f(0.0)) + vec3f(cell) - position) / ray.direction;

        if (t.x < t.y && t.x < t.z) {
            position += ray.direction * t.x;
            cell.x += select(-1, 1, ray.direction.x > 0.0);
            side = select(0u, 1u, ray.direction.x < 0.0);
        } else if (t.y < t.z) {
            position += ray.direction * t.y;
            cell.y += select(-1, 1, ray.direction.y > 0.0);
            side = select(2u, 3u, ray.direction.y < 0.0);
        } else {
            position += ray.direction * t.z;
            cell.z += select(-1, 1, ray.direction.z > 0.0);
            side = select(4u, 5u, ray.direction.z < 0.0);
        }

        if (any(cell < vec3i(0)) || any(cell >= vec3i(mapSize))) {
            break;
        }
    }

    result.emissiveSamplingProbability = emissiveSamplingProbability;
    return result;
}
