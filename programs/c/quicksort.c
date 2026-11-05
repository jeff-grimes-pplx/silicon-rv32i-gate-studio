// Recursive Lomuto quicksort on 16 words in place. Exercises stack frames
// (sp/ra save and restore), recursive jal/jalr redirects, and load-use stalls
// during partition scans. Returns the median-pair sum data[7] + data[8] = 760.
unsigned int data[16] = {
    907, 23, 611, 404, 77, 999, 150, 3,
    862, 512, 48, 730, 265, 191, 638, 356
};
unsigned int swaps;
unsigned int partitions;

static void qsort_range(int lo, int hi) {
    if (lo >= hi) return;
    partitions++;
    unsigned int pivot = data[hi];
    int i = lo;
    for (int j = lo; j < hi; j++) {
        if (data[j] < pivot) {
            unsigned int t = data[i];
            data[i] = data[j];
            data[j] = t;
            i++;
            swaps++;
        }
    }
    unsigned int t = data[i];
    data[i] = data[hi];
    data[hi] = t;
    swaps++;
    qsort_range(lo, i - 1);
    qsort_range(i + 1, hi);
}

int main(void) {
    qsort_range(0, 15);
    return (int)(data[7] + data[8]);
}
