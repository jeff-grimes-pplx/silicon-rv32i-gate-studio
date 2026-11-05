// Iterative Fibonacci: fib[0..31] in memory, return fib(30) = 832040.
unsigned int fib[32];

int main(void) {
    fib[0] = 0; fib[1] = 1;
    for (int i = 2; i < 32; i++) fib[i] = fib[i - 1] + fib[i - 2];
    return fib[30];
}
