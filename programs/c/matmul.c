// 3x3 integer matrix product C = A*B. RV32I has no multiply instruction, so
// GCC calls libgcc's shift-and-add __mulsi3. Returns trace(C) = 175.
int A[3][3] = { {2, 7, 1}, {8, 2, 8}, {1, 8, 2} };
int B[3][3] = { {8, 4, 5}, {9, 0, 4}, {5, 2, 3} };
int C[3][3];

int main(void) {
    for (int i = 0; i < 3; i++)
        for (int j = 0; j < 3; j++) {
            int s = 0;
            for (int k = 0; k < 3; k++) s += A[i][k] * B[k][j];
            C[i][j] = s;
        }
    return C[0][0] + C[1][1] + C[2][2];
}
