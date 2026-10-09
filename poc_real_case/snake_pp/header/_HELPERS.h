#pragma once

#include <cmath>
#include "_GLOBALS.h"
#include <random>

inline int SNAP_TO_GRID(int value)
{
  return floor(value / TILE_SIZE) * TILE_SIZE;
}

inline std::string MAKE_CELL_KEY(int top, int right, int bottom, int left)
{
  return std::to_string(top) + std::to_string(right) + std::to_string(bottom) + std::to_string(left);
}

inline int GET_RANDOM_NUMBER(int min, int max)
{
  // This is a placeholder for a better random number generation strategy.
  // It's recommended to have a single std::mt19937 instance in your Game class.
  std::uniform_int_distribution<> distrib(min, max);
  static std::mt19937 gen(std::random_device{}());
  return distrib(gen);
}