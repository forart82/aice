#pragma once

#include <SFML/Graphics.hpp>
#include "../header/Apples.h"
#include "../header/Snake.h"
#include <iostream>

class Point
{

private:
  sf::Font m_font;
  sf::Text m_text;
  sf::Vector2f m_position;

  int m_counter;
  int m_score;

public:
  Point(sf::Vector2f position, int score);
  ~Point();

  void animation();
  void update();
  void draw(sf::RenderTarget &target);

  int getCounter() const;
};
