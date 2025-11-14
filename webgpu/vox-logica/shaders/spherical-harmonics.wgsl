const PI = 3.141592653589793;

const SH0_COEFF = 0.282094792; // sqrt(1/(4*pi))
const SH1_COEFF = 0.488602512; // sqrt(3/(4*pi))

// Evaluate basis SH functions of orders 0..1
// for a normalized direction vector `d`
fn evalSH1(d: vec3f) -> vec4f
{
	return vec4f(SH0_COEFF, SH1_COEFF * d);
}

// Evaluate the spherical integral of basis SH functions
// of orders 0..1 multiplied with the diffuse term max(0, dot(n, x))
// I.e. the decomposition of the diffuse term in SH basis
fn diffuseFromSH1(n: vec3f) -> vec4f
{
	return vec4f(PI * SH0_COEFF, SH1_COEFF * (2.0 * PI / 3.0) * n);
}