#ifndef AICE_RING_BUFFER_H
#define AICE_RING_BUFFER_H

#include <stddef.h>
#include <stdint.h>

typedef struct {
    uint64_t timestamp_ns;
    int32_t sensor_id;
    double value;
} TelemetrySample;

typedef struct {
    TelemetrySample *slots;
    size_t capacity;
    size_t head;
    size_t tail;
    size_t count;
    uint64_t dropped;
} RingBuffer;

int rb_init(RingBuffer *rb, TelemetrySample *backing, size_t capacity);
int rb_push(RingBuffer *rb, const TelemetrySample *sample);
int rb_pop(RingBuffer *rb, TelemetrySample *out_sample);
size_t rb_available(const RingBuffer *rb);
int rb_peek(const RingBuffer *rb, TelemetrySample *out_sample);
void rb_clear(RingBuffer *rb);
uint64_t rb_dropped_count(const RingBuffer *rb);

#endif
