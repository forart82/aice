#pragma once

#include "Cell.h"
#include <vector>
#include <SFML/Graphics.hpp>

class Grid
{

private:
  std::vector<Cell> cells;
  sf::VertexArray vertices;

public:
  Grid();
  ~Grid();

  void createStartZone();

  void update();
  void draw(sf::RenderTarget &target);
};