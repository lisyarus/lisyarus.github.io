%include hash.wgsl

struct ProbeID
{
	origin: vec3i,
	side: u32,
}

const EMPTY_PROBE = 0xffffffffu;
const TOMBSTONE_PROBE = 0x7fffffffu;
const PROBE_HASH_MASK = 0x3fffffffu;

const NULL_INDEX = 0xffffffffu;

const PROBE_ORIGIN_OFFSET = array<vec3i, 6>(
	vec3i(0, 0, 0),
	vec3i(1, 0, 0),
	vec3i(0, 0, 0),
	vec3i(0, 1, 0),
	vec3i(0, 0, 0),
	vec3i(0, 0, 1),
);

fn getProbeID(voxel: vec3i, side: u32) -> ProbeID
{
	let origin = voxel + PROBE_ORIGIN_OFFSET[side];
	return ProbeID(origin, side);
}

fn probeHash(id: ProbeID) -> u32
{
	var result = u32(id.origin.x);
	result = hashCombine(result, u32(id.origin.y));
	result = hashCombine(result, u32(id.origin.z));
	result = hashCombine(result, id.side);
	return hashCombine(result, 0x3e683d5cu);
}

struct ConcurrentDiffuseProbe
{
	hash: atomic<u32>,
	relevance: u32,

	colorR: f32,
	colorG: f32,
	colorB: f32,
	variance: f32,
}

fn findDiffuseProbe(probes: ptr<storage, array<ConcurrentDiffuseProbe>, read_write>, id: ProbeID) -> u32
{
    let tableSize = arrayLength(probes);
    let hash = probeHash(id);

    for (var i = 0u; i < tableSize; i += 1u) {
    	let index = (hash + i * i) % tableSize;

    	let currentHash = atomicLoad(&probes[index].hash);
    	if ((currentHash & PROBE_HASH_MASK) == (hash & PROBE_HASH_MASK)) {
    		return index;
    	} else if (currentHash == EMPTY_PROBE) {
    		return NULL_INDEX;
    	}
    }

    return NULL_INDEX;
}

// Must only be called if findDiffuseProbe returned NULL_INDEX
fn spawnDiffuseProbe(probes: ptr<storage, array<ConcurrentDiffuseProbe>, read_write>, probeCount: ptr<storage, atomic<u32>, read_write>, id: ProbeID) -> u32
{
    let tableSize = arrayLength(probes);
    let hash = probeHash(id);

    for (var i = 0u; i < 256u; i += 1u) {
    	let index = (hash + i * i) % tableSize;

    	var currentHash = atomicLoad(&diffuseProbes[index].hash);
    	if (currentHash == EMPTY_PROBE || currentHash == TOMBSTONE_PROBE) {
    		while (true) {
	    		let swapResult = atomicCompareExchangeWeak(&diffuseProbes[index].hash, currentHash, hash & PROBE_HASH_MASK);
	    		if (swapResult.exchanged) {
	    			atomicAdd(probeCount, 1u);
	    			return index;
	    		} else if (swapResult.old_value != EMPTY_PROBE && swapResult.old_value != TOMBSTONE_PROBE) {
	    			break;
	    		}
	    		currentHash = swapResult.old_value;
    		}
    	}
    }

    return NULL_INDEX;
}

fn removeDiffuseProbe(probes: ptr<storage, array<ConcurrentDiffuseProbe>, read_write>, probeCount: ptr<storage, atomic<u32>, read_write>, index: u32)
{
	atomicStore(&probes[index].hash, TOMBSTONE_PROBE);
	atomicSub(probeCount, 1u);
}