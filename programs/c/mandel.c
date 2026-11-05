// Fixed-point Mandelbrot set drawn as ASCII into memory (40 x 12 characters,
// one row per 40 bytes). Multiplies go through libgcc's __mulsi3. Returns the
// number of points that stayed bounded.
#define W 40
#define H 12
#define FRAC 12
char image[H][W + 1];
static const char shade[] = " .:-=+*#%@";

int main(void) {
    int inside = 0;
    for (int py = 0; py < H; py++) {
        for (int px = 0; px < W; px++) {
            int cx = -2 * (1 << FRAC) + (px * (3 * (1 << FRAC)) / W);   // -2.0 .. 1.0
            int cy = -(1 << FRAC) + (py * (2 * (1 << FRAC)) / H);       // -1.0 .. 1.0
            int x = 0, y = 0, i = 0;
            while (i < 18) {
                int xx = (x * x) >> FRAC, yy = (y * y) >> FRAC;
                if (xx + yy > (4 << FRAC)) break;
                y = ((2 * x * y) >> FRAC) + cy;
                x = xx - yy + cx;
                i++;
            }
            if (i == 18) inside++;
            image[py][px] = shade[i >= 18 ? 9 : i / 2];
        }
        image[py][W] = 0;
    }
    return inside;
}
