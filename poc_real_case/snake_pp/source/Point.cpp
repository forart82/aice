#include <SFML/Graphics.hpp>
#include "../header/Apples.h"
#include "../header/Snake.h"
#include <iostream>
#include <sstream>

Point::Point(sf::Vector2f position, int score) : m_position(position), m_counter(150), m_score(score), m_text(m_font)
{
  if (!m_font.openFromFile("arial.ttf"))
  {
    throw std::runtime_error("FATAL ERROR: Could not load font 'arial.ttf'.");
  }

  this->m_text.setFont(this->m_font);
  this->m_text.setCharacterSize(16);
  this->m_text.setFillColor(COLOR_CREAM);
  this->m_text.setOutlineColor(COLOR_BLACK);
  this->m_text.setOutlineThickness(2.f);
  this->m_text.setPosition(position);
}

Point::~Point() {}

void Point::animation()
{
}

void Point::update()
{
  this->m_counter--;
  if (this->m_counter > 0)
  {
    std::stringstream ss;
    ss << this->m_score;
    this->m_text.setString(ss.str());
  }
  this->m_position.y -= 1;
  this->m_text.setFont(this->m_font);
  this->m_text.setPosition(this->m_position);
}

void Point::draw(sf::RenderTarget &target)
{
  if (this->m_counter > 0)
  {
    target.draw(this->m_text);
  }
}

int Point::getCounter() const
{
  return m_counter;
}
