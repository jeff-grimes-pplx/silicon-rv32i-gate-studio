// O(log n) 2x2 matrix exponentiation for Fibonacci: [1 1; 1 0]^30.
// On base RV32I (without M), each multiply calls libgcc __mulsi3, showing
// why algorithmic O(log n) with software multiply costs more cycles than
// O(n) iterative additions for n = 30. Returns fib(30) = 832040.
unsigned int mat_result[4];

static void mat_mul(unsigned int c[4], const unsigned int a[4], const unsigned int b[4]) {
    unsigned int c0 = a[0] * b[0] + a[1] * b[2];
    unsigned int c1 = a[0] * b[1] + a[1] * b[3];
    unsigned int c2 = a[2] * b[0] + a[3] * b[2];
    unsigned int c3 = a[2] * b[1] + a[3] * b[3];
    c[0] = c0; c[1] = c1; c[2] = c2; c[3] = c3;
}

int main(void) {
    unsigned int res[4]  = { 1, 0, 0, 1 };
    unsigned int base[4] = { 1, 1, 1, 0 };
    int n = 30;
    while (n > 0) {
        if (n & 1) mat_mul(res, res, base);
        mat_mul(base, base, base);
        n >>= 1;
    }
    for (int i = 0; i < 4; i++) mat_result[i] = res[i];
    return (int)res[1];
}
