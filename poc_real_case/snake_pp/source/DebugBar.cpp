#include "../header/DebugBar.h"
#include <iostream>

DebugBar::DebugBar() : m_text(m_font), m_isFontLoaded(false), m_isActive(false)
{
  this->m_text.setCharacterSize(16);
  this->m_text.setFillColor(sf::Color::Blue);
  this->m_text.setPosition({10.f, 10.f});
}

DebugBar::~DebugBar() {}

void DebugBar::update(sf::Time timePerFrame, sf::Time timeSinceLastUpdate)
{
  this->m_isFontLoaded = m_font.openFromFile("arial.ttf");
  if (!this->m_isFontLoaded)
  {
    throw std::runtime_error("FATAL ERROR: Could not load font 'arial.ttf' for DebugBar.");
  }

  std::stringstream ss;
  ss << "Target FPS: 60\n";
  ss << "Time per frame: " << timePerFrame.asSeconds() << " s\n";
  ss << "Time since last update: " << timeSinceLastUpdate.asSeconds() << " s\n";
  this->m_text.setString(ss.str());
}

void DebugBar::draw(sf::RenderWindow &window)
{
  if (this->m_isActive)
  {
    window.draw(this->m_text);
  }
}

void DebugBar::switchActive()
{
  this->m_isActive = !this->m_isActive;
}