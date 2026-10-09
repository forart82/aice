#include "../header/Cell.h"
#include <SFML/Graphics.hpp>
#include "../header/_GLOBALS.h"
#include "../header/_HELPERS.h"
#include <iostream>

using namespace std;

Cell::Cell(
    sf::Vertex *rect,
    sf::Vector2f position,
    sf::Color color)
    : m_rect(rect),
      m_position(position),
      m_color(color),
      m_top(position.y),
      m_left(position.x + TILE_SIZE),
      m_bottom(position.y + TILE_SIZE),
      m_right(position.x),
      m_key(MAKE_CELL_KEY(m_top, m_right, m_bottom, m_left))
{
  this->manageCell(rect, position);
}

Cell::~Cell()
{
}

void Cell::update()
{
}

void Cell::manageCell(sf::Vertex *rect, sf::Vector2f position)
{
  this->setPosition(position);
  this->setKey();
  this->setTriangles(rect);
  this->setRectColor();
}

// MARK: Setter
void Cell::setPosition(sf::Vector2f position)
{
  this->m_position = position;

  // Update the vertex positions
  this->m_top = SNAP_TO_GRID(position.y);
  this->m_right = SNAP_TO_GRID(position.x + TILE_SIZE);
  this->m_bottom = SNAP_TO_GRID(position.y + TILE_SIZE);
  this->m_left = SNAP_TO_GRID(position.x);
}
void Cell::setKey()
{
  this->m_key = MAKE_CELL_KEY(this->m_top, this->m_right, this->m_bottom, this->m_left);
}

void Cell::setTriangles(sf::Vertex *rect)
{
  this->m_rect = rect;

  // Define the 4 corners of the quad
  sf::Vector2f topLeft(this->m_left + GAP_SIZE, this->m_top + GAP_SIZE);
  sf::Vector2f topRight(this->m_right - GAP_SIZE, this->m_top + GAP_SIZE);
  sf::Vector2f bottomLeft(this->m_left + GAP_SIZE, this->m_bottom - GAP_SIZE);
  sf::Vector2f bottomRight(this->m_right - GAP_SIZE, this->m_bottom - GAP_SIZE);

  // Define the 2 triangles that make up the quad
  // Triangle 1
  this->m_rect[0].position = topLeft;
  this->m_rect[1].position = topRight;
  this->m_rect[2].position = bottomLeft;
  // Triangle 2
  this->m_rect[3].position = topRight;
  this->m_rect[4].position = bottomRight;
  this->m_rect[5].position = bottomLeft;
}

void Cell::setRectColor()
{
  if (this->m_rect != nullptr)
  {
    for (int i = 0; i < 6; ++i)
    {
      this->m_rect[i].color = this->m_color;
    }
  }
}

void Cell::setColor(sf::Color color)
{
  this->m_color = color;
}

// MARK: Getter

std::string Cell::getKey() const
{
  return this->m_key;
}

sf::Color Cell::getColor()
{
  return this->m_color;
}

sf::Vector2f Cell::getPosition() const
{
  return this->m_position;
}