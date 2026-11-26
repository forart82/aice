#include "ring_buffer.h"

int rb_init(RingBuffer *rb, TelemetrySample *backing, size_t capacity) {
    if (!rb || !backing || capacity == 0) {
        return -1;
    }
    rb->slots = backing;
    rb->capacity = capacity;
    rb->head = 0;
    rb->tail = 0;
    rb->count = 0;
    rb->dropped = 0;
    return 0;
}

int rb_push(RingBuffer *rb, const TelemetrySample *sample) {
    if (!rb || !sample || !rb->slots || rb->capacity == 0) {
        return -1;
    }
    if (rb->count == rb->capacity) {
        rb->tail = (rb->tail + 1) % rb->capacity;
        rb->count--;
        rb->dropped++;
    }
    rb->slots[rb->head] = *sample;
    rb->head = (rb->head + 1) % rb->capacity;
    rb->count++;
    return 0;
}

int rb_pop(RingBuffer *rb, TelemetrySample *out_sample) {
    if (!rb || !out_sample || !rb->slots || rb->count == 0) {
        return -1;
    }
    *out_sample = rb->slots[rb->tail];
    rb->tail = (rb->tail + 1) % rb->capacity;
    rb->count--;
    return 0;
}

size_t rb_available(const RingBuffer *rb) {
    if (!rb) {
        return 0;
    }
    return rb->count;
}

int rb_peek(const RingBuffer *rb, TelemetrySample *out_sample) {
    if (!rb || !out_sample || !rb->slots || rb->count == 0) {
        return -1;
    }
    *out_sample = rb->slots[rb->tail];
    return 0;
}

void rb_clear(RingBuffer *rb) {
    if (!rb) {
        return;
    }
    rb->head = 0;
    rb->tail = 0;
    rb->count = 0;
}

uint64_t rb_dropped_count(const RingBuffer *rb) {
    if (!rb) {
        return 0;
    }
    return rb->dropped;
}
