const VOXEL_DIFFUSE = 0u;
const VOXEL_EMISSIVE = 1u;

struct VoxelData
{
    mode: u32,
    albedo: vec3f,
    emission: vec3f,
}

fn unpackVoxelData(data: u32) -> VoxelData
{
    let baseColor = vec3f(vec3u(data & 255u, (data >> 8) & 255u, (data >> 16) & 255u)) / 255.0;
    let mode = data >> 24;

    if (mode == VOXEL_DIFFUSE) {
        return VoxelData(mode, baseColor, vec3f(0.0));
    } else {
        return VoxelData(mode, vec3f(0.0), 32.0 * baseColor);
    }
}