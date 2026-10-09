#pragma once

#include "Cell.h"
#include <vector>
#include <SFML/Graphics.hpp>
#include "../header/Snake.h"
#include "../header/Point.h"
#include <random>

class Apples
{

private:
  std::vector<Cell> m_cells;
  sf::VertexArray m_vertices;
  std::vector<Point> m_points;

  int m_size;

  bool m_activeApples[7];
  std::vector<sf::Clock> clocks;

public:
  Apples(std::mt19937 &rng);
  ~Apples();

  void createApples(std::mt19937 &rng);
  void createApple(int index, std::mt19937 &rng);
  void checkIfEat(Snake &snake, std::mt19937 &rng);
  void checkAppleTime();

  void update(Snake &snake, std::mt19937 &rng);
  void draw(sf::RenderTarget &traget);
};