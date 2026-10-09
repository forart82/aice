#include "../header/Grid.h"
#include "../header/_GLOBALS.h"
#include "../header/_HELPERS.h"
#include <iostream>
#include <SFML/Graphics.hpp>

Grid::Grid()
{
  int numCells = (SCREEN_WIDTH / TILE_SIZE) * (SCREEN_HEIGHT / TILE_SIZE);
  cells.reserve(numCells); // Reserve memory to avoid reallocations
  vertices.setPrimitiveType(sf::PrimitiveType::Triangles);
  vertices.resize(numCells * 6);
  createStartZone();
}
Grid::~Grid() {}

void Grid::createStartZone()
{
  int cellCounter = 0;

  for (int height = SNAP_TO_GRID(SCOREBOARD_HEIGHT); height < SCREEN_HEIGHT; height += TILE_SIZE)
  {
    for (int width = SNAP_TO_GRID(0); width < SCREEN_WIDTH; width += TILE_SIZE)
    {
      // Get a pointer to the first vertex of the current quad
      sf::Vertex *triangels = &vertices[cellCounter * 6];
      // Use emplace_back to construct the Cell in-place
      cells.emplace_back(triangels, sf::Vector2f(width, height), COLOR_BLACK);
      cellCounter++;
    }
  }
}

void Grid::update()
{
  // Future grid update logic
}

void Grid::draw(sf::RenderTarget &target)
{
  // Draw all vertices in a single, efficient draw call
  target.draw(vertices);
}
