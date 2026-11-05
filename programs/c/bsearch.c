// Binary search for several keys in a sorted table; each probe count is
// recorded. Returns the index of key 733 (= 21).
const unsigned table[32] = {
    2, 5, 11, 17, 23, 31, 41, 47, 59, 67, 73, 83, 97, 101, 113, 127,
    137, 149, 163, 179, 193, 733, 811, 823, 907, 947, 1013, 1061, 1123, 1187, 1259, 1301 };
const unsigned keys[4] = { 733, 2, 1301, 600 };
int found[4];
int probes[4];

int main(void) {
    for (int q = 0; q < 4; q++) {
        int lo = 0, hi = 31, idx = -1, n = 0;
        while (lo <= hi) {
            int mid = (lo + hi) >> 1;
            n++;
            if (table[mid] == keys[q]) { idx = mid; break; }
            if (table[mid] < keys[q]) lo = mid + 1; else hi = mid - 1;
        }
        found[q] = idx; probes[q] = n;
    }
    return found[0];
}
