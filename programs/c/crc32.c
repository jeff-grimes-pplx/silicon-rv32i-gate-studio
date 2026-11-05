// Bitwise CRC-32 (IEEE 802.3, reflected, poly 0xEDB88320) of the message
// below. Returns the checksum; compare with zlib.crc32.
const char message[] = "Silicon RV32I five-stage pipeline";
unsigned int checksum;

int main(void) {
    unsigned crc = 0xFFFFFFFFu;
    for (const char *p = message; *p; p++) {
        crc ^= (unsigned char)*p;
        for (int k = 0; k < 8; k++) crc = (crc >> 1) ^ (0xEDB88320u & -(crc & 1));
    }
    checksum = ~crc;
    return checksum;
}
