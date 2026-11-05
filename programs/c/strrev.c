// Reverse a string in place, byte loads and stores. Returns its length (25).
char text[] = "the quick brown fox jumps";

int main(void) {
    int n = 0;
    while (text[n]) n++;
    for (int i = 0, j = n - 1; i < j; i++, j--) {
        char t = text[i]; text[i] = text[j]; text[j] = t;
    }
    return n;
}
