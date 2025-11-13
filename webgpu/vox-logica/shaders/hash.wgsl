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
