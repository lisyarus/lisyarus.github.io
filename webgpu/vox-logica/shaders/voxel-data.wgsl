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