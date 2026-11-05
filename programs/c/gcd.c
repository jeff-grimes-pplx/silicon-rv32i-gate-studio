// Binary GCD (Stein's algorithm) over a table of pairs; results stored
// next to the inputs. Returns gcd(1071, 462) = 21.
struct pair { unsigned a, b, g; };
struct pair table[6] = {
    {1071, 462, 0}, {48, 18, 0}, {270, 192, 0}, {65536, 4096, 0}, {17, 5, 0}, {600851475, 25, 0},
};

static unsigned gcd(unsigned a, unsigned b) {
    if (a == 0) return b;
    if (b == 0) return a;
    int shift = 0;
    while (((a | b) & 1) == 0) { a >>= 1; b >>= 1; shift++; }
    while ((a & 1) == 0) a >>= 1;
    while (b) {
        while ((b & 1) == 0) b >>= 1;
        if (a > b) { unsigned t = a; a = b; b = t; }
        b -= a;
    }
    return a << shift;
}

int main(void) {
    for (int i = 0; i < 6; i++) table[i].g = gcd(table[i].a, table[i].b);
    return table[0].g;
}
