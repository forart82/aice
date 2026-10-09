#include <SFML/Graphics.hpp>
#include "../header/Game.h"
#include "../header/_GLOBALS.h"
#include "../header/Lost.h"
#include <iostream>

Lost::Lost() : m_lostText(m_font), m_isFontLoaded(false), m_isActive(false)
{

  this->m_isFontLoaded = m_font.openFromFile("arial.ttf");
  if (!this->m_isFontLoaded)
  {
    throw std::runtime_error("FATAL ERROR: Could not load font 'arial.ttf' for DebugBar.");
  }

  this->m_lostText.setCharacterSize(72);
  this->m_lostText.setFillColor(sf::Color::Red);
  this->m_lostText.setOutlineColor(sf::Color::Black);
  this->m_lostText.setOutlineThickness(3.f);
  this->m_lostText.setPosition({200, 200});
  this->m_lostText.setString("Game Over");
}

Lost::~Lost() {}

void Lost::update(Snake &snake)
{
  if (snake.getIsDead())
  {
    this->m_isActive = true;
  }
}
void Lost::draw(sf::RenderTarget &target)
{
  if (this->m_isActive)
  {
    target.draw(this->m_lostText);
  }
}

void Lost::setIsActive(bool isActive)
{
  this->m_isActive = isActive;
}