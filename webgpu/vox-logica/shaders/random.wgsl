%include hash.wgsl

struct RandomGenerator
{
    state: u32,
}

fn randomInit(gen: ptr<function, RandomGenerator>, value: u32)
{
    var x = (*gen).state;
    x = hashCombine(x, value);
    (*gen).state = x;
}

fn randomUint(gen: ptr<function, RandomGenerator>) -> u32
{
    var x = (*gen).state;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    (*gen).state = x;
    return x;
}

fn random(gen: ptr<function, RandomGenerator>) -> f32
{
    return f32(randomUint(gen)) / 4294967295.0;
}

fn randomCube(gen: ptr<function, RandomGenerator>) -> vec3f
{
    return vec3f(random(gen), random(gen), random(gen));
}

fn randomSphere(gen: ptr<function, RandomGenerator>) -> vec3f
{
    const PI = 3.141592653589793;

    let phi = 2.0 * PI * random(gen);
    let cosTheta = 2.0 * random(gen) - 1.0;
    let sinTheta = sin(acos(cosTheta));

    return vec3f(sinTheta * cos(phi), sinTheta * sin(phi), cosTheta);
}

fn randomCosineHemisphere(gen: ptr<function, RandomGenerator>, n : vec3f) -> vec3f
{
    return normalize(n + randomSphere(gen));
}