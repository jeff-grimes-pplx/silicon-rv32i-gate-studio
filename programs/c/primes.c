// Sieve of Eratosthenes: fill `primes` with the first 100 primes and
// return the 100th (541). No multiply or divide needed.
#define LIMIT 560
static unsigned char composite[LIMIT + 1];
unsigned int primes[100];

int main(void) {
    for (int i = 2; i + i <= LIMIT; i++) {
        if (composite[i]) continue;
        for (int j = i + i; j <= LIMIT; j += i) composite[j] = 1;
    }
    int n = 0;
    for (int i = 2; i <= LIMIT && n < 100; i++)
        if (!composite[i]) primes[n++] = i;
    return primes[99];
}
