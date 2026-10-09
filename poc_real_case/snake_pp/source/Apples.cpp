#include "../header/Apples.h"
#include "../header/Snake.h"
#include "../header/_HELPERS.h"
#include "../header/_GLOBALS.h"
#include <array>

enum class AppleType
{
  Grow,
  Shrink,
  SpeedUp,
  SpeedDown,
  DoubleSize,
  HalfSize,
  ResetSize
};

#include <math.h>
#include <iostream>

Apples::Apples(std::mt19937 &rng) : m_size(MAX_APPLES), m_activeApples{true, true, true, true, true, true, true}
{

  this->m_cells.clear();
  this->m_cells.reserve(this->m_size);

  this->m_vertices.clear();
  this->m_vertices.setPrimitiveType(sf::PrimitiveType::Triangles);
  this->m_vertices.resize(this->m_size * 6);

  for (int i = 0; i < m_size; ++i)
  {
    this->clocks.emplace_back();
  }

  const std::array<sf::Color, MAX_APPLES> colors = {
      COLOR_VIOLET, COLOR_ROSE, COLOR_MINT_GREEN, COLOR_RED,
      COLOR_ORANGE, COLOR_YELLOW, COLOR_CLEAR_BLUE};

  for (int i = 0; i < MAX_APPLES; ++i)
  {
    std::uniform_int_distribution<> distribX(0, SCREEN_WIDTH - TILE_SIZE);
    std::uniform_int_distribution<> distribY(SCOREBOARD_HEIGHT, SCREEN_HEIGHT - TILE_SIZE);
    int randX = distribX(rng);
    int randY = distribY(rng);
    sf::Vertex *triangles = &this->m_vertices[i * 6];
    this->m_cells.emplace_back(Cell(triangles, sf::Vector2f(randX, randY), colors[i]));
  }
}

Apples::~Apples() {}

void Apples::update(Snake &snake, std::mt19937 &rng)
{
  this->createApples(rng);
  this->checkIfEat(snake, rng);
  this->checkAppleTime();
  for (auto &point : this->m_points)
  {
    point.update();
  }
}

void Apples::createApples(std::mt19937 &rng)
{
  for (int i = 0; i < MAX_APPLES; i++)
  {
    if (!this->m_activeApples[i])
    {
      createApple(i, rng);
    }
  }
}

void Apples::createApple(int index, std::mt19937 &rng)
{
  std::uniform_int_distribution<> distribX(0, SCREEN_WIDTH - TILE_SIZE);
  std::uniform_int_distribution<> distribY(SCOREBOARD_HEIGHT, SCREEN_HEIGHT - TILE_SIZE);
  sf::Vertex *triangles = &this->m_vertices[index * 6];
  this->m_cells[index].manageCell(triangles, sf::Vector2f(distribX(rng), distribY(rng)));
  this->m_activeApples[index] = true;
}

void Apples::checkIfEat(Snake &snake, std::mt19937 &rng)
{
  std::string snakeHeadKey = snake.getFirstCellKey();

  for (int i = 0; i < MAX_APPLES; i++)
  {
    if (snakeHeadKey == this->m_cells[i].getKey() && this->m_activeApples[i])
    {
      this->m_activeApples[i] = false;
      this->clocks[i].restart();
      snake.incrementScore();

      this->m_points.emplace_back(this->m_cells[i].getPosition(), snake.getScore());
      switch (i)
      {
      case static_cast<int>(AppleType::Grow): // Size++
        snake.incrementSize(1);
        break;
      case static_cast<int>(AppleType::Shrink): // Size--
        snake.decrementSize(1);
        break;
      case static_cast<int>(AppleType::SpeedUp): // Speed++
        snake.incrementSpeed(0.01f);
        break;
      case static_cast<int>(AppleType::SpeedDown): // Speed--
        snake.decrementSpeed(0.01f);
        break;
      case static_cast<int>(AppleType::DoubleSize): // Size x2
        snake.doubleSize();
        break;
      case static_cast<int>(AppleType::HalfSize): // Size /2
        snake.halfSize();
        break;
      case static_cast<int>(AppleType::ResetSize): // Size = 3
        snake.startSize();
        break;
      default:
        break;
      }
    }
  }
  // Remove expired points
  auto it = this->m_points.begin();
  while (it != this->m_points.end())
  {
    if (it->getCounter() <= 1)
    {
      it = this->m_points.erase(it);
    }
    else
    {
      ++it;
    }
  }
}

void Apples::checkAppleTime()
{
  for (int i = 0; i < MAX_APPLES; i++)
  {
    float seconds = this->clocks[i].getElapsedTime().asSeconds();
    if (seconds > MAX_APPLES_TIME)
    {
      this->m_activeApples[i] = false;
      this->clocks[i].restart();
    }
  }
}

void Apples::draw(sf::RenderTarget &target)
{
  target.draw(this->m_vertices);
  for (auto &point : this->m_points)
  {
    point.draw(target);
  }
}