#include <stdint.h>

typedef struct {
    int32_t x;
    int32_t y;
} Point2D;

int32_t dot_product(Point2D a, Point2D b) {
    return (a.x * b.x) + (a.y * b.y);
}
