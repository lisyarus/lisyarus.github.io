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
    voxelType: u32,
    point: vec3f,
    side: u32, // -X, +X, -Y, +Y, -Z, +Z
    emissiveSamplingProbability: f32,
}

const NO_INTERSECTION = RaytraceResult(false, vec3i(0), 0u, vec3f(0.0), 0u, 0.0);

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

const CHUNK_SIZE = 4;

fn raytraceScene(ray : Ray, worldOrigin: vec3i, chunksDataAtlas: texture_3d<u32>, chunks: texture_3d<u32>) -> RaytraceResult
{
    let worldSizeInChunks = vec3i(textureDimensions(chunks));

    let worldBbox = AABB(vec3f(0.0), vec3f(worldSizeInChunks * CHUNK_SIZE));

    let rayOffsetOrigin = ray.origin - vec3f(worldOrigin * CHUNK_SIZE);

    var intersection = rayAABBIntersection(Ray(rayOffsetOrigin, ray.direction), worldBbox);

    if (intersection.range.min > intersection.range.max || intersection.range.max < 0.0) {
        return NO_INTERSECTION;
    }

    var position = rayOffsetOrigin + ray.direction * max(intersection.range.min, 0.0);
    var chunk = max(vec3i(0), min(vec3i(floor(position / f32(CHUNK_SIZE))), worldSizeInChunks - vec3i(1)));
    var side = intersection.side;

    while (true)
    {
        let chunkData = textureLoad(chunks, chunk, 0);
        if (chunkData.a != 0u) {
            let chunkDataOffset = vec3i(chunkData.xyz) * CHUNK_SIZE;
            var voxelLocal = max(vec3i(0), min(vec3i(CHUNK_SIZE - 1), vec3i(floor(position)) - chunk * CHUNK_SIZE));
            while (true) {
                let voxelData = textureLoad(chunksDataAtlas, chunkDataOffset + voxelLocal, 0).r;
                if (voxelData != 0u) {
                    return RaytraceResult(true, voxelLocal + (chunk + worldOrigin) * CHUNK_SIZE, voxelData, position + vec3f(worldOrigin * CHUNK_SIZE), side, 0.0);
                }

                let t = (select(vec3f(0.0), vec3f(f32(1.0)), ray.direction > vec3f(0.0)) + vec3f(voxelLocal + chunk * CHUNK_SIZE) - position) / ray.direction;

                if (t.x < t.y && t.x < t.z) {
                    position += ray.direction * t.x;
                    voxelLocal.x += select(-1, 1, ray.direction.x > 0.0);
                    side = select(0u, 1u, ray.direction.x < 0.0);
                } else if (t.y < t.z) {
                    position += ray.direction * t.y;
                    voxelLocal.y += select(-1, 1, ray.direction.y > 0.0);
                    side = select(2u, 3u, ray.direction.y < 0.0);
                } else {
                    position += ray.direction * t.z;
                    voxelLocal.z += select(-1, 1, ray.direction.z > 0.0);
                    side = select(4u, 5u, ray.direction.z < 0.0);
                }

                if (any(voxelLocal < vec3i(0)) || any(voxelLocal >= vec3i(CHUNK_SIZE))) {
                    break;
                }
            }
            chunk += select((voxelLocal - vec3i(CHUNK_SIZE - 1)) / CHUNK_SIZE, voxelLocal / CHUNK_SIZE, voxelLocal >= vec3i(0));
        } else {
            let t = (select(vec3f(0.0), vec3f(f32(CHUNK_SIZE)), ray.direction > vec3f(0.0)) + vec3f(chunk * CHUNK_SIZE) - position) / ray.direction;

            if (t.x < t.y && t.x < t.z) {
                position += ray.direction * t.x;
                chunk.x += select(-1, 1, ray.direction.x > 0.0);
                side = select(0u, 1u, ray.direction.x < 0.0);
            } else if (t.y < t.z) {
                position += ray.direction * t.y;
                chunk.y += select(-1, 1, ray.direction.y > 0.0);
                side = select(2u, 3u, ray.direction.y < 0.0);
            } else {
                position += ray.direction * t.z;
                chunk.z += select(-1, 1, ray.direction.z > 0.0);
                side = select(4u, 5u, ray.direction.z < 0.0);
            }
        }

        if (any(chunk < vec3i(0)) || any(chunk >= worldSizeInChunks)) {
            break;
        }
    }

    return NO_INTERSECTION;
}
