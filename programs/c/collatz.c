// Longest Collatz chain for starting values below 100: 97 takes 118 steps.
// Returns the start value; the step count is stored in `best_steps`.
unsigned best_start, best_steps;
unsigned steps[100];

int main(void) {
    for (unsigned n = 1; n < 100; n++) {
        unsigned x = n, s = 0;
        while (x != 1) { x = (x & 1) ? 3 * x + 1 : x >> 1; s++; }
        steps[n] = s;
        if (s > best_steps) { best_steps = s; best_start = n; }
    }
    return best_start;
}
