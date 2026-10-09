#include "../header/Snake.h"
#include <SFML/Graphics.hpp>
#include "../header/_GLOBALS.h"
#include "../header/_HELPERS.h"
#include "../header/_ENUMS.h"
#include <iostream>
#include <vector>
#include <algorithm>

Snake::Snake() : m_size(MIN_SNAKE_SIZE),
                 m_speed(0.1f),
                 m_direction(Direction::Right),
                 m_isMoving(false),
                 m_canSwitchDirection(true),
                 m_score(0.f),
                 m_speedCounter(0.1f),
                 m_isDead(false)
{
  make();
}

Snake::~Snake() {}

void Snake::make()
{
  this->m_size = MIN_SNAKE_SIZE;
  this->m_speed = 0.1f;
  this->m_score = 0.f;
  this->m_speedCounter = 0.1f;
  this->m_canSwitchDirection = true;
  this->m_isDead = false;
  this->m_direction = Direction::Right;
  this->m_isMoving = false;

  this->m_cells.clear();
  this->m_cells.reserve(MAX_SNAKE_SIZE);

  this->m_vertices.clear();
  this->m_vertices.setPrimitiveType(sf::PrimitiveType::Triangles);
  this->m_vertices.resize(this->m_size * 6);

  for (int i = 0; i < m_size; i++)
  {
    sf::Vertex *triangels = &this->m_vertices[i * 6];
    this->m_cells.emplace_back(Cell(triangels, sf::Vector2f(300 - (i * TILE_SIZE), 300), COLOR_GREEN));
  }
}

void Snake::update(sf::Time timePerFrame, sf::Time timeSinceLastUpdate)
{

  this->m_time += timePerFrame.asSeconds();
  if (this->m_time > this->m_speed && this->m_isMoving && !this->m_isDead)
  {
    this->m_time = 0;

    std::vector<sf::Vector2f> positions;
    positions.reserve(this->m_size);
    if (this->m_size > 3)
    {
      std::cout << this->m_size << std::endl;
    }
    for (int i = 0; i < this->m_size; i++)
    {
      if (i < this->m_cells.size())
      {
        positions.emplace_back(this->m_cells[i].getPosition());
      }
      else
      {
        positions.emplace_back(this->m_cells.end()[-1].getPosition());
      }
    }

    // Efficiently move the snake: move the tail cell to the head's new position.
    sf::Vector2f nextPosition = m_cells.front().getPosition();
    sf::Vector2f previousPosition = nextPosition;
    changePosition(nextPosition);
    applyBoundaries(nextPosition);

    this->m_vertices.clear();
    this->m_vertices.resize(m_size * 6);

    this->m_cells.clear();
    this->m_cells.reserve(this->m_size);
    sf::Vertex *triangles = &this->m_vertices[0];
    this->m_cells.emplace_back(Cell(triangles, nextPosition, COLOR_GREEN));
    for (int i = 1; i < this->m_size; i++)
    {

      // WORK HERE position and cells have not the same size
      sf::Vertex *triangles = &this->m_vertices[i * 6];
      this->m_cells.emplace_back(Cell(triangles, previousPosition, COLOR_GREEN));
      previousPosition = positions[i];

      if (nextPosition == positions[i])
      {
        m_isDead = true;
        m_isMoving = false;
        return; // Exit update early
      }
    }

    this->m_canSwitchDirection = true;
  }
}

void Snake::draw(sf::RenderTarget &target)
{
  target.draw(this->m_vertices);
}

void Snake::changePosition(sf::Vector2f &position)
{
  switch (this->m_direction)
  {
  case Direction::Up:
    position.y -= TILE_SIZE;
    break;
  case Direction::Left:
    position.x -= TILE_SIZE;
    break;
  case Direction::Right:
    position.x += TILE_SIZE;
    break;
  case Direction::Down:
    position.y += TILE_SIZE;
    break;
  }
}

void Snake::applyBoundaries(sf::Vector2f &position)
{
  if (position.x < 0)
  {
    position.x = SCREEN_WIDTH - TILE_SIZE;
  }
  if (position.x >= SCREEN_WIDTH)
  {
    position.x = 0;
  }
  if (position.y < SNAP_TO_GRID(SCOREBOARD_HEIGHT))
  {
    position.y = SCREEN_HEIGHT - TILE_SIZE;
  }
  if (position.y >= SCREEN_HEIGHT)
  {
    position.y = SCOREBOARD_HEIGHT;
  }
}

void Snake::switchMoving()
{
  this->m_isMoving = !this->m_isMoving;
}

void Snake::switchDirection(sf::Keyboard::Scancode code)
{
  if (this->m_canSwitchDirection)
  {
    Direction newDirection = m_direction;
    switch (code)
    {
    case sf::Keyboard::Scancode::W:
    case sf::Keyboard::Scancode::Up:
      if (m_direction != Direction::Down)
        newDirection = Direction::Up;
      break;
    case sf::Keyboard::Scancode::A:
    case sf::Keyboard::Scancode::Left:
      if (m_direction != Direction::Right)
        newDirection = Direction::Left;
      break;
    case sf::Keyboard::Scancode::S:
    case sf::Keyboard::Scancode::Down:
      if (m_direction != Direction::Up)
        newDirection = Direction::Down;
      break;
    case sf::Keyboard::Scancode::D:
    case sf::Keyboard::Scancode::Right:
      if (m_direction != Direction::Left)
        newDirection = Direction::Right;
      break;
    }
    m_direction = newDirection;
    this->m_canSwitchDirection = false;
  }
}

void Snake::incrementScore()
{
  this->m_score += this->m_size + (this->m_size * this->m_speedCounter);
}

void Snake::incrementSpeed(float value)
{
  this->m_speed -= value;
  this->m_speedCounter += value;
}
void Snake::decrementSpeed(float value)
{
  this->m_speed += value;
  this->m_speedCounter -= value;
}

void Snake::incrementSize(int value)
{
  if (this->m_size < MAX_SNAKE_SIZE)
  {
    this->m_size += value;
  }
}

void Snake::decrementSize(int value)
{
  if (this->m_size > MIN_SNAKE_SIZE)
  {
    this->m_size -= value;
  }
}

void Snake::doubleSize()
{
  this->m_size *= 2;
  if (this->m_size > MAX_SNAKE_SIZE)
  {
    this->m_size = MAX_SNAKE_SIZE;
  }
}

void Snake::halfSize()
{
  this->m_size /= 2;
  if (this->m_size < MIN_SNAKE_SIZE)
  {
    this->m_size = MIN_SNAKE_SIZE;
  }
}

void Snake::startSize()
{
  this->m_size = MIN_SNAKE_SIZE;
}

// MARK: Setter
void Snake::setIsMoving(bool isMoving)
{
  this->m_isMoving = isMoving;
}
void Snake::setSpeed(float speed)
{
  this->m_speed = speed;
}

void Snake::setSize(int size)
{
  this->m_size = size;
}

// MARK: Getter
std::string Snake::getFirstCellKey()
{
  return this->m_cells[0].getKey();
}

float Snake::getScore() const
{
  return this->m_score;
}

float Snake::getSpeed() const
{
  return this->m_speed;
}

float Snake::getSpeedCounter() const
{
  return this->m_speedCounter;
}

int Snake::getSize() const
{
  return this->m_size;
}

bool Snake::getIsDead() const
{
  return this->m_isDead;
}
