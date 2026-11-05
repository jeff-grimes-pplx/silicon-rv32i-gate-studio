// Bubble sort 16 words in place; watch the array reorder in memory.
// Returns the number of swaps performed.
unsigned int data[16] = { 907, 23, 611, 404, 77, 999, 150, 3, 862, 512, 48, 730, 265, 191, 638, 356 };

int main(void) {
    unsigned swaps = 0;
    for (int i = 0; i < 15; i++)
        for (int j = 0; j < 15 - i; j++)
            if (data[j] > data[j + 1]) {
                unsigned t = data[j]; data[j] = data[j + 1]; data[j + 1] = t;
                swaps++;
            }
    return swaps;
}
