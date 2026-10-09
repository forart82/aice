#pragma once

#include "Cell.h"
#include <vector>
#include "_GLOBALS.h"
#include "_ENUMS.h"
#include <SFML/Graphics.hpp>

class Snake
{

private:
  std::vector<Cell> m_cells;
  sf::VertexArray m_vertices;
  int m_size;
  float m_speed;
  float m_time;
  Direction m_direction;
  bool m_isMoving;
  bool m_canSwitchDirection;
  float m_score;
  float m_speedCounter;
  bool m_isDead;

public:
  Snake();
  ~Snake();

  void make();

  void update(sf::Time timePerFrame, sf::Time timeSinceLastUpdate);
  void draw(sf::RenderTarget &target);

  void changePosition(sf::Vector2f &position);
  void applyBoundaries(sf::Vector2f &position);
  void switchMoving();
  void switchDirection(sf::Keyboard::Scancode code);

  void incrementScore();
  void incrementSpeed(float value);
  void decrementSpeed(float value);

  void incrementSize(int value);
  void decrementSize(int value);

  void doubleSize();
  void halfSize();
  void startSize();

  // MARK: Setter
  void setCellsColorBlack();
  void setIsMoving(bool isMoving);
  void setSpeed(float speed);
  void setSize(int size);

  // MARK: GETTER
  std::string getFirstCellKey();
  float getScore() const;
  float getSpeed() const;
  float getSpeedCounter() const;
  int getSize() const;
  bool getIsDead() const;
};